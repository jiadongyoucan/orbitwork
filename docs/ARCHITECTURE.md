# OrbitWork — Architecture & Engineering Notes

> Version 2.4 · 2026-11-26 · Single-node, Docker-first deployment.
> This document is the source of truth for the implementation in this repository. The customer-facing HTML version lives at `docs/architecture.html`.

## 1. Product scope (shipped v1)

OrbitWork is a multi-tenant, chat-first AI workbench. The shipped scope is deliberately a complete vertical slice, not an unbounded clone:

- Email/password accounts with opaque server-side sessions.
- Workspaces with `owner / admin / member` roles, invitations, audit logs.
- Agents with system prompt, model, skills, connectors, memory and sandbox switches.
- Chat with SSE streaming, persistent messages, cancellation, partial-message recovery, token usage and demo fallback when no model key is configured.
- Memory with explicit records, keyword retrieval and an agent `save_memory` tool.
- Sandbox: JavaScript execution in a dedicated worker, serial, 6-second timeout, capped output. Production Compose uses a file queue and a `network_mode: none` container.
- Expert / skill / connector assets with draft/published/suspended lifecycle, immutable version snapshots, publish and install.
- Plugin bundles: expert/skill/connector snapshots installed atomically into a workspace.
- Marketplace with search, filters, featured items, stars, install counts and admin moderation.
- Platform admin console for stats, content moderation, user support, password reset and audit.

Explicit non-goals in v1 (documented in product roadmap): file/RAG uploads, scheduled automations, billing, email verification/password-reset email, SSE event replay after reconnect, multi-instance horizontal scaling, vector memory, OAuth/SSO.

## 2. Architecture style

A modular monolith with explicit boundaries. This keeps deployment cheap (one app container + one sandbox container + Caddy + one SQLite volume) while preserving seams for future extraction.

```
Browser (React 19 SPA)
  │ HTTPS, JSON, fetch-based SSE
Caddy (TLS, compression, SSE-friendly reverse proxy)
  │
Fastify 5 HTTP interface
  ├── auth / workspace / asset / chat / admin routes
  ├── application services (agent runtime, seed)
  ├── domain rules (schemas, RBAC, errors, security)
  └── infrastructure (node:sqlite, LLM gateway, connectors, sandbox queue, backup)
        │
   SQLite WAL volume          file queue volume          sandbox worker (no network)
```

### Stack decisions

| Area | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 | Native `node:sqlite`, Web APIs, one language |
| HTTP | Fastify 5 | Small, fast, `inject` makes API tests cheap |
| UI | React 19 + TypeScript | SPA with direct control over the studio experience |
| Build | esbuild | 150–300 ms deterministic builds; no Vite/Tailwind toolchain overhead |
| Data | `node:sqlite` (SQLite WAL) | Zero external DB; ACID; simple backup; ideal single ECS node |
| Auth | scrypt + opaque sessions hashed in DB | Revocable sessions, no JWT invalidation problem |
| LLM | OpenAI-compatible Chat Completions | DeepSeek, Qwen, Moonshot, vLLM, Ollama etc. |
| Sandbox | separate worker, file queue, network-none container | no shared network, no Docker socket, no app secrets |
| Deploy | Docker Compose + Caddy | reproducible local and Aliyun ECS deployment |

SQLite is an intentional v1 trade-off. Capacity target is ≤200 active users per node. Application SQL is direct and workspace-scoped; moving to PostgreSQL is a storage-layer migration rather than an API redesign (see §12).

## 3. Code map

```
server/
  config.ts                  env + model list + Zod auth schemas
  app.ts                     Fastify composition, security headers, error handling
  index.ts / seed.ts / seed-cli.ts / backup.ts
  domain/                    errors, RBAC, crypto, schemas (pure rules)
  application/agent-runtime.ts
  infrastructure/            db + migrations, LLM, connectors, sandbox client,
                             workspace files (files.ts), web fetch (web.ts), trace (trace.ts)
  http/context.ts            session auth, workspace membership, audit helpers
  http/rate-limit.ts         identity-scoped fixed windows
  http/routes/               auth, workspaces, agents, chats, memories, files, assets, admin, misc
  sandbox-worker.ts          queue + loopback HTTP dev worker
src/
  pages/                     Landing, Auth, Home, Chat, Agents, Assets, Market, Memories,
                             Files, Sandbox, Members, Settings, Admin
  components/                AppShell, UI primitives, Markdown, Icon
  context/                   AuthContext, ToastContext
  lib/                       api client, SSE parser, types, utils
tests/                       domain + API integration (node:test)
```

Dependency direction: `http → application → domain`; infrastructure implements adapters used by application/http. Domain modules never import Fastify or React.

## 4. Data model

```
users ──< sessions
  │
  └──< memberships >── workspaces ──< invitations
                          │
        ┌─────────────────┼─────────────────────┐
        │                 │                     │
      agents            chats                assets ──< asset_versions
        │                 │                     │
        └──< memories     └──< messages          ├──< asset_installs
                          └──< runs             └──< asset_stars
workspaces ──< audit_logs
workspaces ──< files (name unique per workspace; blob on disk by UUID)
chats ──< trace_events (append-only metadata; unique(chat_id, seq))
users ──< platform_audit_logs
```

Key invariants:

- Every tenant-owned row includes `workspace_id`; every child lookup uses `WHERE id = ? AND workspace_id = ?`.
- Chat rows also include `user_id`; chats are private to their creator. Workspace members cannot read another member's private chat, including via overview.
- `assets` is a discriminated aggregate: `kind ∈ expert|skill|connector|plugin`; kind-specific payloads are validated by Zod at create, publish and install.
- `asset_versions` stores immutable JSON snapshots and SHA-256 content hashes. Install reads a snapshot, never the request body.
- Connector secrets are AES-256-GCM encrypted at rest, returned only as key names, never in market payloads, plugin snapshots, clones, logs or client APIs.
- `asset_installs` references the installed clone with `ON DELETE CASCADE`; deleting a clone removes the install record and decrements the source counter in one transaction.
- Foreign keys are enabled; numbered migrations are transactional and recorded with `PRAGMA user_version`.

## 5. Tenancy & authorization

The request pipeline resolves the user and membership before handlers run:

1. `requireUser` hashes the session cookie and checks expiry.
2. `requireWorkspace` resolves workspace + membership and asserts the minimum role.
3. Handlers use the returned `ctx.workspace.id`; object queries include that id.
4. A foreign workspace/object returns **404**, not 403, to avoid existence leaks.

| Action | owner | admin | member | platform admin |
|---|---|---|---|---|
| Read/use agents, assets, memories | ✓ | ✓ | ✓ | via admin UI only |
| Create chats / use workspace | ✓ | ✓ | ✓ | ✓ in own workspace |
| Read another user's chat | — | — | — | — |
| Edit/delete own agent/asset/memory | ✓ | ✓ | ✓ (own) | ✓ |
| Edit/delete others' agent/asset/memory | ✓ | ✓ | — | ✓ |
| Workspace settings, invite, remove member | ✓ | ✓ | — | — |
| Publish assets | ✓ | ✓ | ✓ if enabled | ✓ |
| Change platform role / moderate content | — | — | — | ✓ |

Additional rules: last platform admin cannot be demoted; owners cannot be removed or have their role changed; member-applied invitations cannot exceed the inviter's role; platform roles are never accepted from a request body.

## 6. Authentication & session security

- Passwords: scrypt with a 16-byte random salt, 64-byte derived key; timing-safe comparison.
- Minimum password length: **12** characters for signup, password change and admin reset.
- Session token: 256-bit random, only SHA-256 stored in `sessions`; HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`; 14-day absolute expiry.
- Login: 30 attempts / 10 min per IP **and** 8 attempts / 10 min per account (account key survives IP rotation). Signup: 5 / 10 min per IP. Chat: 12 / min per user. Sandbox: 10 / min per user.
- Mutating requests: Origin allowlist when `APP_ORIGIN` is set; JSON Content-Type required when a body is present; SameSite cookie; CSP, frame-ancestors none, nosniff, referrer policy.
- Trust proxy is **off by default** for direct Node use; Docker Compose trusts only loopback/link-local/private proxy ranges (the Caddy network), so client IPs are read correctly without trusting arbitrary public `X-Forwarded-For`.
- Password change revokes all other sessions. Admin reset revokes all sessions.
- Audit events cover workspace creation, member invitations/roles/removals, agent/asset/memory mutations, asset installs, publication and platform moderation.

## 7. Agent runtime

```
POST message → persist user message + run
             → SSE meta
             → build system prompt: agent + skills + memories + workspace + date
             → model call #1 (streaming)
             → tool calls? execute (memory, sandbox, connector) → model call #2/#3
             → persist assistant message + usage + run status
             → SSE done/error
```

- Supported tools: `save_memory`, `search_memories`, `run_javascript`, one tool per attached connector.
- Tool loop is capped at 3 model iterations. Tool output is capped at 8 KB and labelled untrusted.
- Unknown model ids are rejected server-side against the configured allowlist.
- SSE event types: `meta`, `delta`, `reasoning`, `tool`, `usage`, `done`, `error`; monotonic `id` is emitted.
- Runs are persisted before streaming; cancellation aborts the upstream request and saves partial content with `cancelled` status. Server restart reconciles all `running` runs to `cancelled`.
- Client disconnect aborts the run and persists the partial message. Reopening the chat shows the partial output. Byte-level SSE replay is **not** implemented in v1.
- With no `LLM_API_KEY`, a deterministic demo response is streamed so the full product can be evaluated locally. The UI clearly labels this mode.

## 8. Marketplace lifecycle

```
draft ──publish──► published ──admin suspend──► suspended
  ▲                   │                          │
  └──── edit ─────────┘ (re-enters draft)        └── restore ──► published
```

- Publish validates the kind-specific payload and creates an immutable `asset_versions` row.
- Published assets become public; edits transition them back to a private draft.
- Install requires `status=published AND visibility=public`; it reads the latest snapshot, re-validates it, clones it into the target workspace as a private draft, and records `source_version`.
- Plugin install runs in one transaction: plugin clone + up to 10 validated children + install row + counter.
- Connector secrets are never part of a snapshot; installed connectors have zero secrets and must be configured by the installer.
- Delete is blocked while a source asset has installs. Deleting an installed clone removes the install row and decrements the source counter, allowing reinstall.
- Stars are per-user toggle with transactional counters. Admin moderation writes both workspace and platform audit logs.

## 9. Sandbox threat model

Production path:

```
app ──writes JSON job──► /jobs volume ──► sandbox worker (network_mode:none)
                                              │
                                              └── child node --permission (no fs writes/reads except /tmp)
```

- No network interface on the sandbox container; no Docker socket, no database, no APP_SECRET, no LLM key.
- Read-only root FS; `/tmp` tmpfs; non-root; `cap_drop=ALL`; `no-new-privileges`; pids/memory/CPU limits.
- Serial execution, 6s timeout, 24 KB stdout/stderr cap, 20 KB code cap.
- Node permission model denies filesystem access outside the disposable `/tmp` directory.
- Residual risk: the worker process itself is trusted; it must never be given secrets. The queue volume contains only code and outputs.
- Development path uses a loopback-only HTTP worker with a shared token. It is not exposed by Compose and **does not provide network isolation**; never use it as the production sandbox.


## 9.5 Controlled web access & workspace files (v1.1)

Two capabilities, both implemented in the app process; the sandbox stays `network:none`.

- `web_fetch` tool: `assertSafeUrl(url, { allowPrivate: false })` (the connector env flag cannot unlock it), manual redirects re-validated per hop (max 3), 1 MB response cap, 15 s timeout, HTML→text extraction, 5 fetches per run. Fetched text is labelled untrusted in the tool result and never merged into the system prompt.
- Workspace files: `files` table (migration v3) + blobs at `<DATA_DIR>/files/<workspaceId>/<fileId>`. Display name is metadata only; the on-disk key is a UUID, so path traversal is structurally impossible. Same-name writes upsert, keeping one row and one blob.
- API: raw `application/octet-stream` upload with `?name=&mime=` (no multipart dependency), list, text preview, download, delete. Route-level `bodyLimit` and a strict URL match are the only exemptions from the JSON-only request rule.
- Tools: `list_files`, `read_file` (7.6k chars per call, `offset` to page), `write_file`. Gated by `filesEnabled`; `web_fetch` by `networkEnabled` and `WEB_FETCH_ENABLED`.
- Quotas: 5 MB/file, 200 MB and 500 files per workspace; quotas checked before writing.
- Residual risks: DNS rebinding TOCTOU (validation and connect resolve separately) — mitigation requires pinning the IP at connect time; no PDF/Office parsing; no file versioning; only in-process rate limits.


## 9.6 Conversation trace & reasoning display (v1.2)

- `trace_events` (migration v4) is an append-only metadata stream: `run.start`, `prompt.ready`, `model.call`, `model.first_token`, `tool.call`, `run.done`, `run.error`, with `seq` per chat and `UNIQUE(chat_id, seq)`.
- Writes are isolated from streaming: a failed insert logs and continues. Retention is 1000 rows per chat; the API reports `truncated` / `totalEvents`.
- Nothing sensitive is stored: sizes, tool names, web fetch **host**, durations, status. File names are deliberately excluded; provider errors are redacted (`sk-*`, `Bearer`) and capped at 120 chars.
- `messages.run_id` links an answer to its run; `messages.reasoning_ms` accumulates thinking time **per model call**, so tool execution never inflates it.
- Streaming: SSE gains a `trace` event carrying the same row; the drawer merges REST history with live events by `seq`. `meta` still precedes `trace` for the first two events, so the client keys on `seq`, not `runId`.
- UI: `ReasoningBlock` is collapsed by default, shows a live pulse while thoughts arrive, then the persisted duration; the post-stream silent reload preserves the placeholder message key so an expanded block stays expanded. `TraceDrawer` offers error-only filtering and Markdown export.

## 10. Security controls & residual risks

Implemented: scrypt, opaque sessions, RBAC + object checks, tenant-scoped SQL, Zod validation, CSP, Origin checks, rate limits, encrypted connector secrets, SSRF guard (private/loopback/link-local/metadata, redirects disabled), AES-GCM, immutable marketplace snapshots, audit logs.

Residual risks for v1:
- Single `APP_SECRET` with no key rotation/versioning. Rotating it invalidates connector-secret decryption; plan a keyring before production scale.
- In-process rate limits are per instance; single-node deployment only.
- No MFA, SSO, email verification or self-service password reset (admin reset available).
- No SSE replay after reconnect; partial output is persisted.
- SQLite is single-node; WAL backups with `VACUUM INTO`, not continuous replication.
- Connector egress is not allowlisted per workspace; SSRF guard is baseline, not a full egress firewall.
- Admin cannot read user chats by design; support workflows requiring content access are out of scope.

## 11. Testing strategy

`node:test` + Fastify `inject`, no browser or network dependency:

- Domain unit tests: password salting/verification, AES-GCM tamper detection, RBAC hierarchy, SSRF rejection, payload/plugin validation, slugging.
- API integration tests: signup/login/logout; cross-tenant 404s; same-workspace chat privacy; invite/RBAC; marketplace publish/install/plugin; secret redaction; reinstall after clone deletion; memory authorization; account lockout with IP rotation; chat SSE persistence and ownership; admin moderation; validation errors.
- Manual UI checks via headless Chrome/DevTools at 1440px and 390px (screenshots in `docs/assets`).
- Build verification: `npx tsc --noEmit`, `node scripts/build.mjs`, `NODE_ENV=test npm test`.

Current result: **76/76 tests pass**, typecheck clean, production bundle builds in <300ms.

## 12. Deployment & operations

```
Internet :80/:443
   │
 Caddy (TLS, reverse proxy, SSE flush)
   │
 app (Node 24, non-root, SQLite WAL on named volume, /jobs queue volume)
   │
 sandbox (network:none, read-only, resource-limited, same image, worker command)
```

- Local: `docker compose up -d --build`; Caddy on `http://localhost:8080`.
- Aliyun: single ECS (2 vCPU / 4 GB recommended), Docker Engine + Compose, security group 80/443/22 only.
- Env contract: `.env.example`; v1.1 adds `WEB_FETCH_*` and `FILES_*`; v1.2 adds no new env vars;
  production requires unique `APP_SECRET`, strong seed passwords, `SITE_ADDRESS`, `APP_ORIGIN`, `COOKIE_SECURE=true`, `TRUST_PROXY=loopback,linklocal,uniquelocal` (set by Compose).
- Health: `/api/health`; Compose healthchecks for app and sandbox; Caddy waits for app.
- Backup: `node dist/backup.js` uses SQLite `VACUUM INTO`; retain 14 days; schedule from host cron and copy to Aliyun OSS. Restore = stop app, replace DB file, start app.
- Update: `git pull && docker compose up -d --build`; migrations run at boot. Rollback app image; restore DB backup if schema incompatible.
- Scaling path: move SQLite to RDS PostgreSQL, move rate limits/sessions to Redis, run multiple app replicas behind SLB, keep sandbox as an isolated queue consumer.

## 13. Review gates

| Gate | Reviewer focus | Outcome |
|---|---|---|
| G0 | Architecture, tenancy, sandbox, scope | Conditional go; blocking findings incorporated |
| G1 | Backend security, marketplace, runtime | Findings fixed; regression tests added |
| G2 | Product UX & visual QA (desktop/mobile) | Conditional go; all high fixes applied |
| G3 | Test/quality/build review | Conditional go; clean-install verified |
| G4 | Docker / Aliyun deployment review | Conditional go; static findings fixed; target verification required |
| G5 | Final acceptance | Conditional go; no blocking code defect; target smoke required |
| G9 | v2.0 UI reset + model providers | Conditional go; HIGH findings fixed | Native pickers, grouped IA, provider CRUD, AAD keys, SSRF-per-request |
| G10 | v2.1 workbench cleanup + chat management | GO | Single Workbench entry, sidebar no recents, all-chat/archive management, 71/71 tests |
| G11 | v2.2 account & security hub | GO | Sidebar management entries removed; members moved into settings tabs; 71/71 tests |
| G12 | v2.3 marketing landing / CTA | GO | Logged-out login + start; logged-in start only; first-time signup guidance |
| G13 | v2.4 AI Workforce OS MVP | Conditional GO | Goal→SOP→run→evidence→verify→accept; synthetic flag; blocking risks require explicit admin risk acceptance; 76/76 tests |

Reviewer artifacts and dispositions are recorded in `docs/REVIEW.md`.
