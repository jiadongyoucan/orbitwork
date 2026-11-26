# OrbitWork v1.2 设计：对话轨迹 + 可折叠思考过程

> 目标：每次对话都能回放「发生了什么」，用于排查；助手回答的推理默认折叠、可展开。
> 约束：最低 token、零新依赖、不改变现有 SSE 契约（只增不改）、租户隔离。

## 0. 现状

- `runs` 表已有 run 生命周期（status/model/tokens/started/finished）；`messages.reasoning` 已持久化推理文本；SSE 已有 `reasoning` 事件；Chat.tsx 已有一个裸 `<details>推理过程`。
- 缺口：① 没有任何结构化轨迹，排查只能读日志；② 推理块没有「思考中 / 耗时 / 字数」信息，样式与产品语言不统一；③ `messages` 与 `runs` 没有关联字段，无法把一次回答映射到具体 run。

## 1. 对标结论（摘要）

| 产品 | 轨迹模型 | 形态 | 思考 UI |
|---|---|---|---|
| Claude | 每轮工具调用与 thinking 块 | 内联 + 可展开 | 折叠，标 «Thinking»，展开可见全文 |
| ChatGPT/o 系列 | reasoning summary | 内联 | 折叠，标题「已思考 N 秒」 |
| Manus | 任务步骤/计划时间线 | 右侧步骤流 | 计划与执行分步展示 |
| LangSmith/Langfuse | span 树 + 延迟/token/错误 | 独立 trace 面板 | 不适用 |
| Dify/Coze | 运行日志与节点耗时 | 抽屉/详情页 | 不适用 |

共识：**推理在回答内联折叠**；**执行轨迹独立面板**，按时间排序、带耗时与状态、可展开原始细节。

## 2. 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 新建 `trace_events` 表，不改 `runs` 语义 | 轨迹是 append-only 事实流，便于裁剪与查询 |
| D2 | `messages` 增加 `run_id` 与 `reasoning_ms` | 回答 ↔ run 可关联；「已思考 N 秒」有数据来源 |
| D3 | 轨迹只记**元数据**：长度、耗时、工具名、URL、状态 | 避免把提示词/文件内容/密钥写进轨迹 |
| D4 | 每 chat 上限 1000 条，超限裁掉最旧 100 条 | 单机 SQLite 可控，避免无限增长 |
| D5 | SSE 新增 `trace` 事件（增量） | 抽屉打开时实时追加，不轮询 |
| D6 | 推理默认折叠；流式中标题显示「思考中…」，完成后显示「已思考 N 秒」 | 与对标一致，不打断阅读 |
| D7 | 轨迹查看权限 = 会话所有权（与 chat 详情一致） | 复用既有租户不变量，不新增授权面 |

## 3. 数据模型（migration v4）

```sql
CREATE TABLE trace_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  run_id TEXT,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,          -- run.start | prompt.ready | model.call | model.first_token | tool.call | run.done | run.error
  phase TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_trace_chat ON trace_events(chat_id, seq);

ALTER TABLE messages ADD COLUMN run_id TEXT;
ALTER TABLE messages ADD COLUMN reasoning_ms INTEGER NOT NULL DEFAULT 0;
```

## 4. 采集点（运行时）

| kind | 何时 | detail（脱敏） |
|---|---|---|
| `run.start` | 进入 runAgent | model、agentId、demo |
| `prompt.ready` | 系统提示构建完 | chars、tools 名称列表、文件数、记忆数 |
| `model.call` | 每次模型调用前 | step、messages 数、tools 数 |
| `model.first_token` | 首个 delta/reasoning | ms（相对本次调用） |
| `tool.call` | 每次工具执行后 | name、status、inputChars、outputChars、ms（web_fetch 额外记 host） |
| `run.done` | finally 落库后 | status、tokensIn/Out、ms |
| `run.error` | 异常 | message（截断 300 字） |

- 写入失败不得影响流式：`try/catch` 吞掉并 `console.error`。
- `seq` 取该 chat 当前最大值 +1；插入后若超上限，删除最旧的 100 条。

## 5. API

`GET /api/w/:workspaceId/chats/:chatId/trace?limit=200`

```json
{
  "runs": [{ "id": "...", "status": "complete", "model": "...", "tokensIn": 12, "tokensOut": 340, "startedAt": 0, "finishedAt": 0 }],
  "events": [{ "id": "...", "seq": 3, "kind": "tool.call", "phase": "tool", "status": "ok", "durationMs": 812, "at": 0, "detail": { "name": "web_fetch", "host": "example.com" } }],
  "totals": { "events": 7, "durationMs": 1200, "tokensIn": 12, "tokensOut": 340 }
}
```

权限：与会话详情相同（`workspace_id + user_id`），否则 404。默认 limit 200，最大 500。

## 6. 体验

**思考过程（回答内）**
- 折叠头：`◈ 思考过程 · 已思考 12.4s · 1,832 字`，右箭头；默认收起。
- 流式且尚在推理：`◈ 思考中…`，小圆点脉冲；用户可随时展开。
- 展开体：等宽小字、最大高 260px 滚动、可复制。
- 无推理（非推理模型）时不渲染该块。

**轨迹（会话级）**
- 会话头部新增「轨迹」按钮（Activity 图标），打开大号抽屉。
- 顶部摘要：run 数、总耗时、输入/输出 token、错误数。
- 时间线：按 run 分组，行内显示时间、kind、耗时、状态点；点击展开 JSON 细节；错误行高亮。
- 筛选：全部 / 仅错误；刷新；复制 JSON。

## 7. 安全与隐私

- 轨迹不写提示词正文、文件内容、工具完整输出、密钥；只写长度与名称。
- `web_fetch` 只记 host（不含 query，避免泄露检索词）。
- 轨迹随 chat 删除级联删除；用户只能看自己的会话轨迹。
- 前端渲染 detail 用 `<pre>` 文本，不注入 HTML。

## 8. 测试

- 单元：trace 写入 seq 递增、超限裁剪、detail 截断。
- API：轨迹仅会话所有者可读（他人 404）；run 后存在 4 类以上事件；`limit` 生效；删除 chat 级联清除。
- 回归：41 项既有测试全绿；typecheck；build。
- UI：截图验证折叠态/展开态与轨迹抽屉；无控制台错误。

## 9. 非目标

跨会话全局追踪、span 树/分布式链路、日志导出到 OTel、轨迹重放、token 级成本核算、推理内容编辑。

## 10. 设计评审处置

| 评审发现 | 严重度 | 处置 |
|---|---|---|
| migration v4 裸 `ALTER TABLE messages` 在缺表的历史库上失败；测试断言停在 v3 | BLOCKER | 已修：迁移支持 `run()` 程序化步骤，用 `PRAGMA table_info` 守卫两条 ALTER；断言升到 v4；legacy fixture 补齐 `messages` 表 |
| `trace` 事件早于 `meta` 且载荷没有 runId，按 runId 归组的抽屉会丢前两条 | HIGH | 已修：事件行与 SSE 载荷都带 `runId`；前端按 `seq` 合并，不依赖 `meta` 先后 |
| `reasoning_ms` 用首末 delta 墙钟，跨工具调用被放大 | HIGH | 已修：改为每次模型调用内部累计，工具耗时不计入 |
| `MAX(seq)+1` 无唯一约束；裁剪实际保留 ~1100–1124 | HIGH | 已修：`UNIQUE(chat_id, seq)`；超限即删最旧一条，稳定保留 1000 |
| 轨迹写入原始文件名、300 字供应商错误体 | MED | 已修：移除文件名；错误过滤 `sk-*`/`Bearer` 并截断 120 字，另记原始长度 |
| 展开的推理块在生成结束静默刷新后被重置 | MED | 已修：刷新时保留占位消息 key，组件不重挂载 |
| 轨迹响应静默截断，摘要与窗口不一致 | MED | 已修：返回 `truncated` / `totalEvents`，抽屉显示「仅显示最近 N 条」 |
| 缺少 trace/SSE 测试 | MED | 已修：新增 2 项测试覆盖事件类型、seq 单调、limit 截断、跨租户 404、删除级联、1000 条保留 |

## 11. 实现评审处置

| 评审发现 | 严重度 | 处置 |
|---|---|---|
| `<TraceDrawer>` 重复挂载，出现两层弹窗与两个焦点陷阱 | HIGH | 已修：删除重复块；UI 复验 `document.querySelectorAll('.overlay').length === 1` |
| 切换会话时旧 `sendMessage` 的 finally 覆盖新会话数据、丢失 abort 句柄 | HIGH | 已修：捕获 `activeChatId` + 自增 `runToken`，不匹配则丢弃收尾逻辑 |
| 用户取消被记为 error：写 `runs.error`、推 SSE error、计入错误数 | MED | 已修：`signal.aborted` 时不写 error 轨迹、不推 error、`runs.error` 留空，仅标记 cancelled |
| 取消/异常时当前模型调用的思考耗时丢失 | MED | 已修：每次模型调用在 `finally` 累计思考时间 |
| `runs.error` 原样入库并返回，可能含供应商回显的密钥/URL 参数 | MED | 已修：新增 `redactSecrets`（sk-/Bearer/key/token/secret/signature/URL query）统一脱敏 |
| 迁移缺 `IF NOT EXISTS`；`messages` 缺失时静默跳过 ALTER | MED | 已修：建表/索引幂等；缺表直接抛错，避免带病启动 |
| `MAX(seq)+1` 两条语句，多写者可能撞唯一约束且异常被吞 | LOW | 已修：改为单条 `INSERT … SELECT COALESCE(MAX(seq),0)+1`，并保留唯一约束 |
| `PRUNE_BATCH` 死代码，保留量说明与实现不符 | LOW | 已修：删除死常量，精确保留 1000 条 |
| `run.start` / `prompt.ready` 早于 `meta` | LOW | 已修：`meta` 先发，轨迹随后 |
| 抽屉打开期间不刷新，运行状态停在「进行中」，run.error 不展示 | LOW | 已修：打开时每 3s 刷新，运行行显示错误摘要 |
| 推理结束进入工具调用后仍显示「思考中…」；历史消息被推算秒数 | LOW | 已修：文本停止 1.7s 后强制重渲染；非流式且无耗时只显示「思考过程」 |
| 静默刷新按位置重命名最后一条助手消息，可能命中旧消息 | LOW | 已修：仅当 `runId` 匹配本次运行才保留占位 key |
| 可访问性：`aria-expanded` 无 `aria-controls`、错误卡无 `role=alert` | LOW | 已修：补 region/aria 关联与 alert 角色，移除死文案 |
| 测试缺口（升级列、脱敏、裁剪下界、meta 顺序） | — | 已补 4 项，45/45 通过 |
