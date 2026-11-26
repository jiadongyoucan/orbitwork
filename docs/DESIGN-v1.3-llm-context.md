# OrbitWork v1.3 设计：LLM 接入层与上下文预算

> 依据 `docs/OPTIMIZATION-PLAN.md` 的 v1.3 出口标准：P0-1 + P0-2，附带 P1-3 步数、P1-4-A 定位、P2-6 导出。
> 约束：零新依赖、SSE 契约只增不改、`LLM_ADAPTER=legacy` 可一键回退。

## 0. 范围

| 项 | 本版 | 说明 |
|---|---|---|
| P0-1 LlmPort | 做 | 单实现 + 两种模式（legacy/port），不复制两套解析 |
| P0-2 token 预算 | 做 | 估算 + 优先级裁剪 + trace 记录 |
| P1-3 步数可配 | 做一半 | `AGENT_MAX_STEPS` + 达上限显式提示；工具并行留 v1.4 |
| P1-4 沙箱定位 | 做 A | 文档降级 + 文件系统逃逸回归 |
| P2-6 轨迹消费 | 做 | JSON/Markdown 导出 + 四宫格指标 |
| P1-5 eval | 不做 | 需要录制体系，单列 v1.4 |

## 1. P0-1：LlmPort

**接口**（`server/infrastructure/llm.ts` 内导出，调用方零改动）：

```ts
export type LlmPort = { stream(options: StreamOptions): Promise<ModelResult> };
export type ModelResult = { content; reasoning; toolCalls; usage: { input; output; cachedInput } };
```

**实现**：`createOpenAiAdapter(cfg)` 单一实现，`LLM_ADAPTER` 只切两个能力位：

| 能力 | legacy | port |
|---|---|---|
| 推理字段 | 仅 `reasoning_content` | `reasoning_content` / `reasoning` / `thinking` / `thought` 归一 |
| 重试 | 关闭 | 首包前最多 2 次，429/5xx/网络错误，指数退避 + jitter，尊重 `Retry-After` |
| usage | input/output | 增加 `cachedInput`（`cached_tokens` / `prompt_cache_hit_tokens`） |

**边界**：流已开始（已收到首个 `data:` 块）后不重试，避免重复文本。`LLM_ADAPTER` 默认 `legacy`，灰度后切 `port`。

**测试**：3 份 SSE fixture（DeepSeek / OpenAI / Anthropic 风格）走本地 HTTP server；503→200 重试用例（`retryBaseMs=1`）；cached token 解析。

## 2. P0-2：上下文预算

- 估算：CJK 1 字 ≈ 0.7 token，ASCII 4 字符 ≈ 1 token，另加每条 4 token 结构开销。
- 预算：`LLM_CONTEXT_WINDOW`（默认 128000）中，system 实占后，历史最多 60%，工具输出 20% 通过截断保证。
- 裁剪（`server/domain/context.ts`，纯函数）：
  1. 固定保留**最早一条 user**（目标与背景）；
  2. 从最新往回装，超预算时：tool 消息替换为一行 `[tool output omitted: N chars]`，其余丢弃；
  3. 返回 `{ messages, usedTokens, dropped }`，只影响发送，不改 DB。
- trace `prompt.ready` 增加 `budget: { used, dropped, limit }`。

**验收**：50 轮 + 一条 8KB 工具结果的场景不超预算、首条 user 保留、裁剪条数可断言。

## 3. P1-3：步数

- `AGENT_MAX_STEPS` 默认 6，clamp 1–12；替换 `step < 3`。
- 达上限且最后一步仍有 tool_calls 时：在回答末尾追加「已达到最大步数（N），任务可能未完成」，并 emit `delta` 让用户看见；trace `run.done` 记 `stepLimitHit`。
- 并行工具本版不做（写类顺序性 + provider 限流风险），在文档与产品说明中标注为 v1.4。

## 4. P1-4-A：沙箱定位

- README / DEPLOYMENT 统一改为「受限脚本执行（内部半可信脚本）」，删除安全沙箱式承诺；明确 6s/128MB/串行/无网络是设计边界。
- 回归：新增 `tests/sandbox.test.ts`，用与 worker 相同的 `--permission --allow-fs-read=/tmp` 启动子进程，断言读 `/etc/passwd`、写工作区文件失败；网络隔离由容器 `network:none` 负责（文档说明，不在单测覆盖）。

## 5. P2-6：轨迹消费

- 新事件 `model.done`（每次模型调用结束，含 durationMs 与 usage），用于耗时归因。
- API：`GET /api/w/:ws/chats/:id/trace/export?format=json|md`，`Content-Disposition: attachment`。
- 指标：`{ totalMs, modelMs, toolMs, firstTokenMs }`，由 runs 与事件计算，随 trace 响应返回。
- 抽屉顶部四宫格 + 「导出 JSON / 导出 Markdown」。

## 6. 配置

```dotenv
LLM_ADAPTER=legacy            # legacy | port
LLM_MAX_RETRIES=2
LLM_RETRY_BASE_MS=250
LLM_CONTEXT_WINDOW=128000
AGENT_MAX_STEPS=6
```

## 7. 测试与验收

- 新增：SSE 三风格解析、重试、cached usage、预算裁剪、步数上限、导出、沙箱逃逸（约 10 项）。
- 回归：45 项既有测试全绿；typecheck；build。
- 手工：轨迹四宫格 + 导出文件；长会话不报 provider 400。

## 8. 非目标

工具并行、eval 录制回放、Anthropic/Gemini 原生协议（当前仍是 OpenAI 兼容网关，只做字段归一）、向量库、多 provider key 路由。

## 9. 设计评审处置

| 评审发现 | 严重度 | 处置 |
|---|---|---|
| 历史仍 `LIMIT 30`，pin 的首条 user 只是最近 30 条里的第一条 | BLOCKER | 已修：取最近 2000 条再按 token 裁剪；50 轮场景由预算而非条数决定 |
| 预算只在循环外算一次，2..N 步的工具输出无界 | BLOCKER | 已修：新增 `fitMessages`，每次模型调用前重算；以「assistant + 其 tool 结果」为整轮保留/丢弃，避免孤儿 tool_call |
| 裁剪器看不到 tool 消息，pin 截断按字符而非 token | HIGH | 已修：循环内消息参与 fit；新增 `truncateToTokens` 按估算二分截断，CJK 不再超占 |
| `LLM_ADAPTER` 是 import 单例；非法数字导致 NaN | HIGH | 已修：adapter 每次调用构建；配置用 `num()` 校验并 clamp |
| 重试无 jitter、sleep 不可中断、超时文案与 provider body 泄露 | HIGH | 已修：50%–100% jitter、`abortableSleep`、超时与失败使用通用文案（不回显 provider body） |
| 达到步数上限时仍标记 complete、无最终汇总 | MED | 部分修：回答内显式提示 + trace `stepLimitHit`；不追加额外模型调用（成本），列为已知边界 |
| 指标口径不一致、Markdown 反引号未转义、抽屉 limit 与导出不一致 | MED | 已修：四个指标统一取自同一 trace 窗口；转义反引号；抽屉 500 条；导出改 fetch+blob |
| 沙箱测试手抄 flags，未回归 worker 本身 | MED | 已修：抽出 `sandboxPermissionFlags`，worker 与测试共用；断言无写权限且读白名单固定 4 项 |

## 10. 实现评审处置

| 评审发现 | 严重度 | 处置 |
|---|---|---|
| 流内 error / 200 非 SSE / 空响应被当成成功，落库空消息并 emit done | HIGH | 已修：解析层抛错；`sawData`、`finishReason`、content/toolCalls 三重校验 |
| 收到 `[DONE]` 后仍读 socket，代理不关连接导致 120s 超时 | HIGH | 已修：遇 `[DONE]` 取消 reader 并返回；新增「socket 不关」测试 |
| `model.done` 在 finally 之外，失败/取消的模型调用不计入指标 | HIGH | 已修：移入 finally，带 `status: ok/error` |
| 网关每块重发完整工具名时被拼接成 `read_fileread_file` | MED | 已修：前缀/重发判定，只保留一份 |
| 小窗口（4k–8k）下预算下限过大、系统提示 + 单轮工具结果仍可超窗 | MED | 已修：预算 clamp 到 0；超限时把工具结果压成一行；系统提示本身过大属硬约束（文档记录） |
| 超时覆盖整段生成，长答案被 120s 截断 | MED | 已修：首个事件到达即清除定时器 |
| 累计式 reasoning 流导致重复文本 | MED | 已修：`mergeText` 识别累计前缀，只发射新增部分 |
| 终止步执行了工具但结果永远发不回模型 | MED | 已修：达到步数上限时不执行该步工具 |
| 步数提示写进消息正文，下一轮被当成助手原话 | MED | 已修：改为仅 SSE 推送，不落正文 |
| 抽屉两个「总耗时」口径不一致 | MED | 已修：统一取 `totals.durationMs` |
| `LLM_TIMEOUT_MS`/`SANDBOX_TIMEOUT_MS` 非法值 → NaN 超时 | LOW | 已修：`num()` + 下限 |
| `truncateToTokens` 在 1 token 预算下仍超限 | LOW | 已修：截断后复测，必要时去掉省略号；新增测试 |
| 同毫秒消息排序不稳定 | LOW | 已修：`created_at, rowid` 双排序 |
| 导出按钮无 loading、401 无统一跳登录 | LOW | 未改（已知边界，导出失败会 toast） |
