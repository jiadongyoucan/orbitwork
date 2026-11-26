# OrbitWork 运行时优化方案（v1.3 → v2）

> 背景：v1.2 交付后复盘「agent 运行时 / 沙箱 / LLM 接入是否在重复造轮子」。
> 结论：**大部分手搓是合理的，真正需要换的只有一层**。本文把结论落成可执行的清单。
> 约束（不可破）：单机 Docker 私有化部署、不引入外部托管依赖、SSE 事件契约只增不改、租户隔离强度不回退。

---

## 0. 结论摘要

| # | 问题 | 等级 | 现状 | 目标 | 工作量 |
|---|---|---|---|---|---|
| P0-1 | LLM 接入层锁死 OpenAI 方言、无重试 | P0 | 裸 `fetch` + 手解 SSE | `LlmPort` + adapter + 退避重试 | 1.5 人日 |
| P0-2 | 上下文按「条数」截断，无 token 预算 | P0 | `LIMIT 30` | token 预算 + 优先级裁剪 | 1 人日 |
| P1-3 | 循环固定 3 步、工具全串行 | P1 | `step < 3` | 步数可配 + 只读工具并行 | 1 人日 |
| P1-4 | 沙箱能力与安全叙事不匹配 | P1 | `--permission` + `network:none` | 明确定位（A 或 B） | 0.5 / 5 人日 |
| P1-5 | 无质量回归（eval） | P1 | 45 个测试，全是领域/API | 10 条黄金 case + 录制回放 | 1.5 人日 |
| P2-6 | 轨迹只有写入、没有消费与聚合 | P2 | `trace_events` 表 | 导出 + 耗时汇总 | 1 人日 |

**一句话：`llm.ts` 是唯一「该用库却手写」的地方；agent 循环和沙箱传输层属于「本来就该自己写」。**

---

## 1. 先澄清「手搓」的实际边界

复盘时最容易犯的错是把「行数多」当成「造轮子多」。按真实职责拆开：

| 模块 | 行数 | 真实手写的是什么 | 判定 |
|---|---|---|---|
| [`agent-runtime.ts`](../server/application/agent-runtime.ts) | 596 | 核心循环约 75 行（第 464–537 行）；其余是 prompt 拼装、7 个工具实现、落库、trace | **保留**。固定工具集下，75 行比「框架 + 适配层」短 |
| [`llm.ts`](../server/infrastructure/llm.ts) | 168 | 裸 `fetch` + 手解 SSE + 手拼 tool_calls 增量 | **替换**。这是唯一纯重复劳动 |
| [`sandbox.ts`](../server/infrastructure/sandbox.ts) | 60 | 文件队列的投递/轮询/超时（IPC） | **保留**。没有框架会替定义「app ↔ 沙箱容器」的作业协议 |
| [`sandbox-worker.ts`](../server/sandbox-worker.ts) | 162 | 用 Node `--permission` + Docker `network:none` 组装隔离 | **保留**。隔离原语是成熟的，组装是必要的 |
| [`trace.ts`](../server/infrastructure/trace.ts) | — | append-only 元数据轨迹 | **保留并增强**（P2-6） |

**「成熟框架」要分两类看**：

- **A 类：纯库**（AI SDK / Mastra / LangGraph）——私有化零冲突，**该用没用**。
- **B 类：托管基础设施**（E2B / Daytona / gVisor）——要账号、要 KVM、多一个控制面，与「一台云主机 + `docker compose up`」的定位冲突，**用不了**。

所以「沙箱手搓」是伪命题：它没发明沙箱，只写了作业传输。E2B 不会替你做这件事。

---

## 2. 问题清单与方案

### P0-1 · LLM 接入层：把方言绑定和裸 `fetch` 换掉

**现状（证据）**

- [`llm.ts:81`](../server/infrastructure/llm.ts#L81)：直接 `fetch(${baseUrl}/chat/completions)`，手写请求体。
- [`llm.ts:134`](../server/infrastructure/llm.ts#L134)：只认 `delta.reasoning_content` —— **DeepSeek 私有字段**。换成 Anthropic（`thinking`）、Gemini（`thought`）时，要改的是循环体，不是配置。
- 无任何重试/退避：`grep -rn "retry" server/` 结果为空。一次 429 或连接重置就等于用户看到失败。
- [`config.ts:29`](../server/config.ts#L29)：超时是整轮 120s 的粗粒度一刀切，无首包超时。
- `usage` 只取 `prompt_tokens / completion_tokens`，丢弃缓存命中字段，成本核算不准。

**风险**

- 产品承诺「支持任意 OpenAI 兼容模型」，实际上**兼容性由这 168 行硬编码决定**，每接一个新 provider 都要动核心文件。
- 网络抖动被直接暴露给终端用户，可用性不达「工作台」预期。

**方案**

1. 把已经天然存在的边界显式化：`ChatMessage` / `ToolCall` / `ToolDefinition` 已经是自有类型，抽成 `LlmPort` 接口（`stream(opts): Promise<ModelResult>`），**调用方零改动**。
2. 实现两个 adapter：
   - `openai-compatible`：现有逻辑迁入；
   - `reasoning-normalizer`：把 `reasoning_content` / `reasoning` / `thinking` / `thought` 归一化到统一字段。
3. 容错：仅对「首包到达前」的错误做重试（429 / 5xx / `ECONNRESET`），指数退避 + jitter，最多 2 次；流已开始则不重试（避免用户看到重复文本）。
4. `usage` 归一化：`input / output / cached_input`。

**验收**

- [ ] 新增 3 份 SSE fixture（DeepSeek / OpenAI / Anthropic 风格），单测覆盖解析；
- [ ] 模拟首次 503 后成功，用例通过；
- [ ] `LLM_ADAPTER=legacy|port` 开关可灰度，默认 `legacy`；
- [ ] `npm run typecheck` 与现有 45 个测试全绿。

---

### P0-2 · 上下文：从「条数」改为「token 预算」

**现状（证据）**

- [`agent-runtime.ts:390`](../server/application/agent-runtime.ts#L390)：`ORDER BY created_at DESC LIMIT 30` —— **按条数截断**。
- 单条工具结果可到 8192 字符（[`agent-runtime.ts:517`](../server/application/agent-runtime.ts#L517)），`web_fetch` 可到 7600 字符（[`:283`](../server/application/agent-runtime.ts#L283)）。
- 无 token 估算、无压缩、无重要性分级。

**风险**

- 30 条历史里只要夹着一个大文件读取结果，就会直接超窗，且报错形态是 provider 的原始 400，用户无法理解。
- 反过来，30 条闲聊又浪费了预算。

**方案**

1. 引入近似 token 估算（中文按 1 字 ≈ 0.7 token、ASCII 按 4 字符 ≈ 1 token；无需引入分词库）。
2. 预算：`contextWindow * 0.6` 留给历史，`0.2` 留给工具输出，其余给 system + 回复。
3. 裁剪优先级：**system > 最近 1 条 user > 最近 N 轮 assistant > 旧 tool 结果（可摘要成一行）> 旧 user**。
4. 裁剪只发生在「发送前组装」，DB 中原始消息不删——保证轨迹可回放。

**验收**

- [ ] 构造 50 轮 + 1 个大文件场景，请求不超窗且第一条 user 保留；
- [ ] 裁剪行为有单测（给定预算 → 期望保留集合）；
- [ ] 轨迹 `prompt.ready` 事件新增 `budgetUsed / dropped` 字段。

---

### P1-3 · 循环：步数可配 + 只读工具并行

**现状（证据）**

- [`agent-runtime.ts:464`](../server/application/agent-runtime.ts#L464)：`for (let step = 0; step < 3; ...)` 硬编码。
- [`:506`](../server/application/agent-runtime.ts#L506)：`for (const call of result.toolCalls)` 全串行。

**风险**

- 「多步任务」是核心卖点，却被 3 步卡死；4 步以上的任务会静默截断（用户只看到半截答案）。
- 三个互不依赖的 `read_file` 串行执行，延迟线性叠加。

**方案**

1. `AGENT_MAX_STEPS` 默认 6，上限 12；达到上限时**显式告知用户「已达最大步数」**，而不是静默结束。
2. 只读工具（`search_memories` / `list_files` / `read_file` / `web_fetch`）并发，写类工具（`save_memory` / `write_file` / 连接器）保持串行；并发度默认 2，可降为 1。
3. SSE 新增 `step` 事件（只增不改），前端轨迹抽屉按 step 分组。

**验收**

- [ ] 两个只读工具的用例：总耗时 < 串行的 60%；
- [ ] 写类工具顺序性有单测（顺序不可交换）；
- [ ] 达到上限时 UI 可见提示。

---

### P1-4 · 沙箱：先定定位，再谈技术

**现状（证据）**

- [`sandbox-worker.ts:67`](../server/sandbox-worker.ts#L67)：子进程 + `--permission --frozen-intrinsics --max-old-space-size=128`。
- [`docker-compose.yml:61`](../docker-compose.yml#L61)：`network_mode: none`、`read_only`、`cap_drop: ALL`、`mem_limit: 256m`、`cpus: 0.5`、6s 超时、并发 1。

**风险（真正的问题不是「弱」，是「叙事与能力错位」）**

README 把沙箱写成安全卖点，但当前能力只覆盖「内部半可信脚本」：串行、6s、128MB、无 syscall 过滤、无冷启动隔离。**一旦对外承诺「可跑用户上传代码」，这层就不成立。**

**方案（二选一，必须选）**

- **A. 内部工具沙箱（推荐，0.5 人日）**：保持现状，做三件事——① README / DEPLOYMENT 把措辞降级为「受限脚本执行」；② 补 seccomp 默认 profile 与只读 rootfs 的显式校验；③ 增加 1 个逃逸尝试的回归用例（读 `/etc/passwd`、`fetch` 外网、写文件系统）。
- **B. 用户代码执行（5 人日）**：抽 `SandboxPort`，adapter 接 E2B 或 gVisor；保留 A 作为离线降级路径。

**验收**

- [ ] 定位写进 README 与 `docs/DEPLOYMENT.md`，不再出现超范围表述；
- [ ] 逃逸回归用例通过。

---

### P1-5 · 质量回归：补 eval，而不是换框架

**现状**：45 个测试（`tests/*.test.ts`）覆盖领域规则、API、文件、trace，**没有一条覆盖「模型行为」**。改 prompt、换模型全靠手感。

**方案**

1. `tests/eval/` + 10 条黄金 case：工具选择正确性、拒答边界、提示注入抵抗（网页/文件里的指令）、长上下文不丢首条、取消后无残留、演示模式降级。
2. LLM 用**录制回放**（录制 SSE fixture，回放时零网络、零成本），CI 可跑。
3. `npm run eval`，目标单次 < 60s。

**验收**

- [ ] 10/10 通过；
- [ ] 任意 prompt 改动后，eval 能给出 diff 结论。

---

### P2-6 · 轨迹：从「写入」到「可消费」

**现状**：`trace_events` 已有 7 类事件（[`trace.ts:5`](../server/infrastructure/trace.ts#L5)），但只有前端抽屉消费，无导出、无聚合、无 P95。

**方案**：`GET /api/w/:id/trace/export?format=json|md`；轨迹抽屉顶部加「总耗时 / 模型耗时 / 工具耗时 / 首 token」四宫格；保留 1000 条/会话上限。

---

## 3. 明确不做（防止过度重构）

| 不做 | 理由 |
|---|---|
| 用 LangGraph / Mastra 重写 agent 循环 | 工具集固定、拓扑单一（3–6 步直线），迁移成本 > 收益；框架的 thread/store 抽象与 workspace RBAC 不匹配，硬套要在外面再包一层 |
| 引入向量库 / RAG | v1 明确非目标；关键词 + 显式记忆已满足当前场景 |
| 换 SQLite | ≤200 活跃用户/节点，WAL 足够；迁移是存储层问题，不是 API 问题 |
| 改 SSE 事件 schema | 前端轨迹与推理折叠已强依赖，只允许**新增**字段/事件 |
| 引入 Redis / 消息队列 | 单机形态下引入即破坏「零外部依赖」卖点 |

---

## 4. 路线图

| 版本 | 周期 | 内容 | 出口标准 |
|---|---|---|---|
| v1.3 | 1 周 | P0-1、P0-2 | eval 全绿 + 3 份 provider fixture 通过 + 长会话不超窗 |
| v1.4 | 1 周 | P1-3、P1-5、P2-6 | 并行工具用例达标 + 10 条黄金 case + 轨迹导出可用 |
| v2 | 按需 | P1-4 B 方案 | 仅在「对外承诺跑用户代码」时启动 |

**优先级原则**：先修「会静默出错」的（P0），再修「有天花板」的（P1），最后修「看得见但不出错」的（P2）。

---

## 5. 长期决策规则

| 场景 | 选择 |
|---|---|
| 出现第 2 个 provider、第 2 种 agent 拓扑（反思/子 agent/人工审批） | **用框架** |
| 需要评测回归、可观测性 | **用现成方案**（Langfuse 等），不要自建 |
| 约束来自部署形态（私有化/离线/单机） | **手搓**，框架给不了 |
| 约束来自安全边界（多租户隔离/审计） | **手搓**，框架的抽象对不上 |
| 约束来自 UI 契约（SSE 事件与组件一一对应） | **手搓**，框架会挡在中间 |

**判据**：如果一个能力「换掉后业务代码要改」，那它该被抽象成 Port；如果「换掉后只有配置变」，那它才适合直接引库。

---

## 6. 风险与回滚

| 变更 | 风险 | 回滚 |
|---|---|---|
| `LlmPort` 双实现 | 行为漂移（推理字段、tool_calls 合并） | `LLM_ADAPTER=legacy` 环境变量一键切回 |
| token 预算裁剪 | 历史丢失导致答非所问 | 仅发送时裁剪，DB 原始消息不动；可视化「已裁剪 N 条」 |
| 工具并行 | 触发 provider 限流 / 写操作乱序 | 并发度默认 2 且写类强制串行；`TOOL_CONCURRENCY=1` 可关 |
| 沙箱定位降级 | 市场/销售话术需同步 | 文档先行，README 与 DEPLOYMENT 同批改 |

---

## 附录 A · 代码证据索引

| 事实 | 位置 |
|---|---|
| 核心循环 3 步硬编码 | `server/application/agent-runtime.ts:464` |
| 工具串行执行 | `server/application/agent-runtime.ts:506` |
| 历史按条数截断 | `server/application/agent-runtime.ts:390` |
| 工具输出 8192 上限 | `server/application/agent-runtime.ts:517` |
| `web_fetch` 7600 字符上限 | `server/application/agent-runtime.ts:283` |
| 裸 `fetch` 调用 | `server/infrastructure/llm.ts:81` |
| `reasoning_content` 私有字段 | `server/infrastructure/llm.ts:134` |
| 无重试（grep 为空） | `server/` 全目录 |
| 全局 120s 超时 | `server/config.ts:29` |
| 沙箱 Node 权限模型 | `server/sandbox-worker.ts:67` |
| 沙箱容器隔离参数 | `docker-compose.yml:61` |
| 轨迹事件类型 | `server/infrastructure/trace.ts:4` |

## 附录 B · 验收清单

- [ ] P0-1：`LlmPort` 接口落地，legacy 与 port 双跑一致
- [ ] P0-1：3 份 provider SSE fixture 单测通过
- [ ] P0-2：50 轮 + 大文件场景不超窗
- [ ] P1-3：只读工具并行耗时 < 串行 60%
- [ ] P1-4：沙箱定位写入 README + DEPLOYMENT，逃逸用例通过
- [ ] P1-5：10 条黄金 case 全绿，`npm run eval` < 60s
- [ ] P2-6：轨迹可导出 JSON / Markdown
- [ ] 全程 `npm run typecheck` + 45 个既有测试不回退
