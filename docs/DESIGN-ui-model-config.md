# OrbitWork v2.0 — UI reset + workspace model provider configuration

## Problem

The current shell exposes 11 flat navigation items (workspaces, specialists, skills, connectors, market, files, memories, sandbox, members, settings) with no hierarchy. Home duplicates the same actions in four places (mode pills, quick actions, recent tasks, market mini-cards, stat cards). First-time users cannot answer “where do I start?” or “where do I configure the model?”.

## Product response

### Information architecture

```
Workspace
  工作台       Home: one composer + recent conversations + quick starts
  智能体       Agent list and editor
  能力库       Tabs: 专家 / 技能 / 连接器 (one sidebar entry)
  插件市场     Public marketplace + publish
  文件         Workspace files
  记忆         Workspace memory
Management
  账号与安全（用户菜单）  工作区 / 成员与权限 / 登录安全
  平台管理     Platform admin only
```

The sidebar has three visual groups (工作 / 工具 / 管理), no “NEW” badges, no redundant top-bar actions, no “新建对话” button and no recent-chat list. Recent conversations live only on Home; the sidebar has no duplicate list and no separate “新建对话” action — the Workbench composer is the single entry.

### Home

- Greeting + model readiness chip.
- One centered composer: agent and model selectors, one send button.
- Three suggestion chips below, not a wall of mode pills/actions.
- Two-column lower section: “最近对话” (max 5, with archive/delete and an “已归档” restore modal) and “快速开始” (new agent / install capability / upload file).
- Stats and marketplace promotion move to their own pages; no duplicate cards on home.

### Chat

- Keep the existing message/trace capabilities; reduce chrome by removing duplicate agent badges in the composer.
- Model label remains visible in the header, with a link to model settings when the selected model is in demo mode.

### Models & Providers

New admin page `/app/models`.

**Provider**: name, base URL, API key (write-only, encrypted with APP_SECRET), enabled, preset hint.
Presets: DeepSeek, OpenAI, OpenRouter, Qwen/DashScope, Moonshot, SiliconFlow, Ollama, custom OpenAI-compatible.

**Model**: provider, upstream model id, display label, context window, enabled, default. Models are workspace-scoped; keys never leave the server.

**Fallback**: if a workspace has no configured models, the page and pickers show “平台默认（环境变量）” from `LLM_*`. This keeps existing installations working and makes the migration path explicit.

**Permissions**: owner/admin can create/edit/delete and test providers; members can only see effective model labels in the composer. API keys are never returned; `hasKey` is returned instead.

## Data model

```
providers
  id, workspace_id, name, type(openai-compatible), base_url,
  api_key_encrypted, enabled, created_by, created_at, updated_at
  unique(workspace_id, name)

workspace_models
  id, workspace_id, provider_id, model_id, label, context_window,
  enabled, is_default, created_by, created_at, updated_at
  unique(workspace_id, model_id)
  FK provider_id → providers.id ON DELETE CASCADE
```

Migration v5. Existing `workspaces.settings.defaultModel` remains the pointer to a model id; it is updated when the default changes or a model is deleted.

## Runtime resolution

```
requested model id
  → enabled workspace_models + enabled provider? use that base URL/key
  → else if no workspace models: env LLM_* model
  → else fallback to workspace default/first enabled
  → if key empty: demo mode
```

`streamModel` accepts a resolved provider config. Context budgeting uses the selected model’s `context_window`. Trace/meta events report model + provider name, never the key.

## Security

- Keys AES-256-GCM encrypted; API returns only `hasKey`.
- Provider URL passes SSRF checks; private/loopback providers require `ALLOW_PRIVATE_PROVIDERS=true` (Ollama/local).
- Only workspace owner/admin can mutate provider/model settings; audit every create/update/delete/test.
- Provider test uses `GET /models` with an 8s timeout, no redirects and no response body returned.
- Model ids are validated against effective workspace models for chat/agent/settings writes.

## Acceptance checks

1. First-run home has one primary composer and one recent/quick-start section; no duplicate market/stat panels.
2. Sidebar has grouped “工作” and “管理” sections with a single 能力库 entry.
3. Admin can add a provider (key encrypted, never echoed), add two models, mark one default, and see it in the composer.
4. Member cannot mutate providers/models; can use the default in a new chat.
5. Deleting a provider removes its models and resets the workspace default safely.
6. Existing env-only installs still work when no provider is configured.
7. Tests: model CRUD/permissions/key redaction/default selection; full suite 77/77.
8. Desktop and 390px layouts verified; docs updated.
