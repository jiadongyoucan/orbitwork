# OrbitWork v1.1 设计：受控联网 + 工作区文件

> 目标：让智能体能「上网查资料」和「读写工作空间文件」，同时不破坏现有单节点、私有化、最小依赖的形态。
> 约束：最低 token 实现；不引入新 npm 依赖；不打开沙箱网络；保持租户隔离与审计。

## 0. 现状与问题

- 沙箱容器 `network_mode: none` 是**有意的安全边界**（见 docs/ARCHITECTURE.md §9）。智能体的 `run_javascript` 因此无法联网，也不应放开。
- 数据库无任何文件表，没有上传/下载 API，没有文件 UI，运行时也没有文件工具。
- 结论：联网与文件都必须作为**服务端工具能力**补在 app 进程，而不是改造沙箱。

## 1. 对标结论（摘要）

| 产品 | 联网模型 | 文件模型 | 可复用点 |
|---|---|---|---|
| Claude | 服务端 `web_search` / `web_fetch` 工具，结果标注不可信 | 对话附件 + Artifacts（可迭代产物） | 工具在服务端执行；抓取内容与指令隔离 |
| Manus | 服务端浏览工具 | workspace 级产物，右侧文件面板，可下载 | 工作区文件面板 + 产物可复用 |
| Dify / Coze | 工具插件（搜索/抓取） | 应用级文件变量/知识库 | 能力开关放在工作区/应用级 |
| OpenAI ChatGPT | 内置浏览 | 上传 + 沙箱内生成可下载文件 | 生成物必须可下载 |

共性：**联网是工具，不是给代码执行环境开网络**；文件是**租户级持久资产**，有配额、可下载、可被后续会话复用。

## 2. 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 新增 app 侧 `web_fetch` 工具，沙箱保持离线 | 复用现有 SSRF 守卫；避免给 6s 沙箱开网络导致的 SSRF/内网穿透 |
| D2 | 文件存本地卷（`DATA_DIR/files/`）+ SQLite 元数据 | 与现有单机部署一致，零外部依赖 |
| D3 | 磁盘文件名用 UUID，原始文件名只作元数据 | 路径穿越从结构上不可能；重命名不搬家 |
| D4 | 上传用 raw body（`application/octet-stream`）+ `?name=` | 不引入 `@fastify/multipart`，少一个依赖与一套解析风险 |
| D5 | 同一工作区内文件名唯一，重名即覆盖（upsert） | 符合「工作区文件」心智；智能体重写产物是常态 |
| D6 | 配额：单文件 5 MB、工作区 200 MB、最多 500 个 | 单机 SQLite/磁盘可控，错误可解释 |
| D7 | 仅文本类可预览/可 `read_file`；二进制只下载 | 不引入 PDF/docx 解析依赖，v1 明确边界 |
| D8 | `networkEnabled` / `filesEnabled` 默认开，管理员可关 | 与现有 memory/sandbox 开关一致；企业可按租户收紧 |

## 3. 数据模型（migration v3）

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  name TEXT NOT NULL,              -- 展示名，不含路径
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,       -- <workspace_id>/<id>
  text_preview TEXT NOT NULL DEFAULT '',  -- 文本类前 4KB，用于提示词与列表
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);
CREATE INDEX idx_files_ws ON files(workspace_id, updated_at DESC);
```

不变量：所有查询带 `workspace_id`；`storage_key` 只由服务端生成；删除工作区级联删元数据，磁盘文件由删除路径显式清理。

## 4. API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/w/:ws/files` | 列表（id/name/mime/size/更新人/时间/是否可读） |
| POST | `/api/w/:ws/files?name=&mime=` | raw body 上传或覆盖；校验配额与文件名 |
| GET | `/api/w/:ws/files/:id/content?download=1` | 下载/预览；非图片强制 attachment |
| GET | `/api/w/:ws/files/:id/text` | 文本预览（≤100KB） |
| DELETE | `/api/w/:ws/files/:id` | 删除元数据 + 磁盘文件 |

错误码：`FILE_TOO_LARGE` 413、`WORKSPACE_QUOTA_EXCEEDED` 409、`FILE_COUNT_EXCEEDED` 409、`INVALID_FILE_NAME` 400、`FILE_NOT_TEXT` 415。

## 5. 运行时工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `web_fetch` | `url`, `max_chars?` | SSRF 校验 → 逐跳复检重定向 → HTML 转文本 → 截断返回（500–7600 字符），标注「不可信外部内容」 |
| `list_files` | `limit?` | 返回工作区文件清单（名、大小、更新时间） |
| `read_file` | `name` | 文本类返回内容（≤100KB），二进制返回「请下载」 |
| `write_file` | `name`, `content` | 写入/覆盖，校验配额，返回 id/size |

- 工具是否暴露由 `workspace.settings.networkEnabled/filesEnabled` 决定；关闭时不注册工具，模型无从调用。
- 系统提示注入：最近 20 个文件名 + 尺寸；联网内容必须标注为不可信。
- 频控：`web_fetch` 30 次/分钟/用户；读写在 API 层同样限流。

## 6. 体验

- 新页面「文件」：拖拽/选择上传、搜索、列表（图标/大小/时间）、文本或图片预览、下载、删除、配额进度。
- 设置页新增两个开关（管理员可改）：允许智能体联网抓取、允许工作区文件。
- 聊天工具卡片沿用现有 `toolEvents` 渲染，无需新组件。
- 空状态给出「上传一份资料，然后让智能体读它」的引导。

## 7. 安全

1. SSRF：复用 `assertSafeUrl`（拒绝私网/回环/链路本地/元数据地址、拒绝 URL 内嵌凭据）。
2. 抓取：`redirect: 'error'`、15s 超时、1MB 响应上限、只接受 http/https、`max_chars` 截断。
3. 注入：抓取内容与文件内容一律标注为不可信数据，不进入系统指令区。
4. 上传：文件名去路径与控制字符、长度 ≤120；raw body 限 5MB；计算 sha256。
5. 下发：全局 `nosniff`；HTML/SVG 一律 `attachment`；图片 inline 但 `Content-Disposition` 带 filename。
6. 租户：所有文件路由经 `requireWorkspace`，跨工作区一律 404。
7. 审计：`file.upload` / `file.delete` / `web.fetch` 写入 workspace audit（含 url host、字节数，不含内容）。
8. 配额：写前检查，超限拒绝而不是截断。

## 8. 测试计划

- 单元：文件名规整、文本判定、HTML→文本、配额计算。
- API：上传→列表→预览→下载→删除；重名覆盖；超限 413/409；跨租户 404；非文本 415；`filesEnabled=false` 拒绝。
- 运行时：工具注册受开关控制；`web_fetch` 拒绝 localhost/私网；工具输出截断。
- 回归：既有测试全绿（当前全套 41 项）；typecheck；build。

## 9. 非目标（v1.1）

PDF/docx/xlsx 解析、OCR、向量检索、文件夹树、分享链接、文件版本历史、沙箱联网、`web_search`（需外部搜索供应商）、对象存储。

## 10. 评审处置（2026-11-26）

独立 reviewer 对设计 + 代码做了两轮对抗性评审，处置如下。

| 评审发现 | 严重度 | 处置 |
|---|---|---|
| `assertSafeUrl` 会被 `ALLOW_PRIVATE_CONNECTORS` 关闭，`web_fetch` 可能打到元数据地址 | BLOCKER | 已修：`assertSafeUrl(url, {allowPrivate})`，`web_fetch` 强制 `false`；回归测试断言该开关无法解锁 |
| DNS rebinding：校验与连接各解析一次 | BLOCKER | 接受为残余风险并写入架构文档；彻底修复需在 connect 阶段固定已验证 IP（下一版，需替换 fetch 为带 `lookup` 的 http(s) 请求） |
| IPv6/NAT64/6to4/CIDR 判定漏网 | HIGH | 已修：改为逐字节「非全球单播即拒绝」，含 `::ffff:`、`64:ff9b::`、`2002::`、Teredo、`198.18/15` 等；19 条 URL 表格测试 |
| 配额竞态、崩溃留下孤儿字节 | HIGH | 单进程内 `putFile` 全同步无 `await`，检查与写入不会被并发打断；新增启动清理陈旧 `.tmp`；跨实例场景写入技术债 |
| 文件名进入系统提示，可被构造成指令 | HIGH | 已修：系统提示只给文件数量，名称一律通过 `list_files` 工具获取 |
| `read_file` 承诺 100KB，但工具结果被 8192 字符截断 | HIGH | 已修：每次 7.6k 字符 + `offset` 分页，返回值带区间与续读提示 |
| 删除工作区残留 `FILES_DIR/<ws>` | MED | 已修：删除工作区后清理磁盘目录 |
| 上传豁免用 `includes('/files')` 过宽 | MED | 已修：改为 `^/api/w/[^/?]+/files(\?|$)` 精确匹配 |
| 成员可读全部文件、删除受限，策略不一致 | MED | 设计上明确：文件是工作区共享资产（对标 Project knowledge），读开放、删限创建者/管理员；读取不写审计以控噪音 |
| 建议裁掉 sha256/text_preview/chat_id、配额收敛为单一 200MB | — | 未采纳：sha256 用于完整性校验，text_preview 预留给后续检索；配额三项均已在 UI 展示，成本低 |

## 11. 实现评审处置（第二轮）

| 评审发现 | 严重度 | 处置 |
|---|---|---|
| 成员可覆盖他人同名文件（删除有校验、覆盖没有） | MED | 已修：`putFile` 增加创建者校验，成员覆盖他人文件返回 `FILE_OWNED_BY_OTHER`；智能体写入补 `file.agent_write` 审计 |
| 列表 `LIMIT 200` 小于 500 配额，第 201 个文件不可见也不可删 | MED | 已修：列表上限改为 `FILES_MAX_COUNT`，配额始终可回收 |
| `read_file` 在 100KB 窗口末尾仍建议继续 offset，模型空转 | MED | 已修：`readText` 区分「窗口内还有」与「窗口已到顶」，到顶时提示下载而不再建议 offset |
| `web_fetch` 允许 20000 字符但工具结果统一截到 8192 | MED | 已修：`max_chars` 收敛到 500–7600，默认 6000；1MB 截断显式标注 |
| `networkEnabled=false` 未拦住连接器出网 | MED | 已修：连接器仅在联网开关下注册；执行时二次校验，并与 `web_fetch` 共用每轮 5 次出口预算 |
| 文件功能关闭后前端仍显示入口，点击必 403 | MED | 已修：导航隐藏「文件」，页面切换为说明态并给出设置入口 |
| 用户提交的 MIME 原样回写，控制字符可导致永久 500 | LOW | 已修：MIME 走 `type/subtype` 白名单正则，否则降级 `application/octet-stream` |
| 文件响应 `private, max-age=60` 覆盖全局 `no-store` | LOW | 已修：改为 `no-store` |
| 设置页用平台角色判断可编辑，平台管理员但非工作区管理员会被 403 | LOW | 已修：仅按工作区 `owner/admin` 判断 |
| 网页按 UTF-8 解码，GBK 页面乱码 | LOW | 已修：读取 `Content-Type`/`<meta charset>` 并用 `TextDecoder` 解码 |
| 下载用裸 `<a>`，401/403 会把 SPA 导航到 JSON 错误页 | — | 已修：改为 fetch + Blob 下载，失败弹 toast |
| SSRF DNS rebinding TOCTOU | BLOCKER（设计） | 仍为残余风险：需在 connect 阶段固定已校验 IP。当前以「逐跳复验 + 私网全拒 + 1MB/15s + 每轮预算」收敛影响，并写入架构文档技术债 |
