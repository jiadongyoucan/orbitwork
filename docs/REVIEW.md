# OrbitWork Review Log

Independent reviewer subagents were used at each major gate. This file records findings and dispositions. It intentionally includes the NO-GO decisions, not only the final state.

## G0 — Architecture / scope / security

**Reviewer:** independent architecture reviewer
**Verdict:** NO-GO as initially scoped; GO for a reduced v1 once blockers were incorporated.

Key findings accepted:
- Tenant object access must be enforced by construction (`workspace_id` in every child lookup, 404 for foreign objects).
- Marketplace installs must be snapshot-based and validated at install; publisher-controlled payload/credentials cannot become victim configuration.
- Publishing needs immutable versions; connectors must not carry secrets into public payloads or clones.
- Sandbox needs a single production isolation path, not an in-process fallback beside the API.
- SSE needs run persistence, cancellation and partial-message recovery; no infinite locks.
- Migrations and a consistent backup strategy are required.

Changes made: tenant-scoped SQL across routes, `asset_versions` snapshots, strict payload schemas, encrypted connector secrets, separate sandbox worker, file-queue/network-none production topology, numbered migrations, `VACUUM INTO` backup, run lifecycle and cancellation, plus regression tests.

## G1 — Backend security / marketplace / runtime

**Reviewer:** independent backend security reviewer
**Verdict:** NO-GO initially; all blockers fixed and re-reviewed to **GO**.

### Blocking findings and fixes

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Public market could leak connector `Authorization` headers / credentials | Removed public connector `headers` from schema; all credentials only via encrypted `secrets`; market serialization redacts connector headers; plugin nested connector headers rejected; install snapshots revalidated | anonymous market response contains no secret/header; header-in-payload create returns 400 |
| 2 | Workspace `overview.recentChats` leaked other members' private chat titles | Added `AND c.user_id = ?` to recent chats, usage and chat stats | same-workspace member overview has 0 recent chats and 0 stats |
| 3 | Login rate limit could be bypassed by rotating `X-Forwarded-For` | Trust proxy defaults to false; Compose trusts only loopback/link-local/private proxy ranges; added account-scoped lockout independent of IP | 10 attempts with different remote IPs/XFF hit 429 |

### High findings and fixes

| Finding | Fix |
|---|---|
| Deleting an installed clone orphaned the install record, permanently blocking reinstall | `asset_installs.installed_asset_id` FK with `ON DELETE CASCADE` (migration 2); delete clone in a transaction, remove install row, decrement source counter; plugin child cleanup |
| Stale `runs` could lock a chat forever after a crash | On boot mark all running runs cancelled; before each message expire runs older than 15 minutes when not active |
| Any member could edit/delete another member's memory and poison prompts | Members may only mutate their own memories; members cannot write agent-scoped memory for another user's agent; admins/owners can govern |
| Sandbox shared network with app and could call internal API | Production now uses a file queue with `network_mode: none`; no shared network; app only writes job files; worker has no secrets |
| `/sandbox/run` ignored workspace toggle | Route now rejects when `sandboxEnabled=false`; agent runtime already honored it |
| Worker could bind publicly with default token | HTTP mode binds `127.0.0.1`; production HTTP mode refuses default token; Docker uses queue mode with no HTTP execution |
| Admin role/password changes were unaudited | Added `platform_audit_logs`, platform audit on role reset/password reset/moderation; last-admin invariant |
| Docs claimed persisted rate limits, repository interfaces, 12-char minimum, JSON enforcement, mocked tool-loop tests | Corrected docs to match implementation; added JSON content-type enforcement; password minimum now 12; removed repository/tool-loop claims |

### G1 final re-review

**GO.** Reviewer independently reproduced a full v1→v2 migration with an orphan install, confirmed the orphan is removed, legacy headers are scrubbed from assets and snapshots, memory read scope, active-run expiry, per-user throttles, counter decrement and 8192-byte tool cap. Non-blocking follow-ups: recompute `content_hash` after scrub (now done), wrap scrub in a transaction (now done), use a full v1 fixture (synthetic fixture remains; reviewer ran a full-schema emulation manually).

### Coverage added

Market redaction, overview privacy, account lockout with IP rotation, reinstall after clone deletion, memory authorization, stale-run recovery, reinstall counter, file DB migration + backup reopen, same-workspace chat privacy, admin moderation, JSON/validation errors. Current: 23/23 tests.

## G2 — Product UX / visual QA

**Reviewer verdict:** CONDITIONAL; blocking trust/affordance issues fixed.

| Finding | Disposition |
|---|---|
| Composer advertised non-existent @/slash pickers and an unconditional “技能已注入” chip | Removed misleading placeholders; Chat and Home now say “describe your task / continue”; inert chip removed |
| Seed assistant message looked like a real model call | Seed rows now use `status='sample'`; UI shows “示例内容” and hides model/token metadata; demo-mode badges link to model settings |
| Marketplace install dead ends; publish shown without permission; CTA enabled with zero items | Install routes to the installed kind (connector → configure credentials), publish CTA reflects `allowMemberPublish`, plugin CTA requires ≥1 item, failed plugin publish cleans up its draft |
| API failures looked like empty success states | Added explicit ErrorState + retry to Market, Agents, Memories and Assets |
| Mobile chat table clipped with no cue | Markdown tables wrapped in a horizontal scroll container with a visible “横向滑动” hint |
| Accessibility: low contrast faint text, unlabeled inputs, non-keyboard cards, modal/sidebar focus | Raised `--faint` contrast, added aria-labels, keyboard-openable market cards, modal focus trap/restore, hidden off-canvas sidebar from tab order |
| “继续最近的任务” linked to “全部智能体” | Replaced with a “仅你可见” privacy label |
| Sandbox template chips / demo RBAC visibility | Lower-priority polish; not launch-blocking, documented as roadmap |

## G3 — Test / build / quality

**Reviewer verdict:** CONDITIONAL; blockers fixed, clean-install verified.

| Finding | Disposition |
|---|---|
| Clean checkout typecheck failed on undeclared `vite/client`; `test:watch` used undeclared vitest | Removed `vite/client`, removed nonexistent config includes, switched test:watch to node:test --watch; clean `npm ci` → tsc/build/tests pass |
| macOS dev sandbox failed (`/var` permission) | Worker defaults `SANDBOX_TMP_DIR=/tmp`; dev script also sets it; manual `console.log(2+2)` verified |
| Fastify parser 4xx surfaced as 500 | Error handler now preserves 4xx statuses; malformed JSON and wrong content type tests added |
| Seeding republished suspended assets after restart | Seed now runs marketplace seed only on first database creation; regression test |
| Tool-output 8KB cap claim false | All tool outputs centrally sliced to 8192 bytes |
| Production APP_SECRET placeholder accepted | Fail-fast on `CHANGE_ME`/short secrets; seed credential placeholders rejected on first boot |
| Doc drift (admin fallback, table count, trust proxy, restore WAL) | README/docs corrected; table count 16; restore removes WAL/SHM and fixes ownership |
| Missing `/assets/*` returned SPA HTML | Static asset misses now 404 |

**Final commands:** clean install → `tsc` 0 errors; 23/23 tests; esbuild build ~150–300ms. Docker remains unverified in this environment.

## G4 — Deployment / security operations

**Reviewer verdict:** CONDITIONAL; all static blockers fixed.

| Finding | Disposition |
|---|---|
| Restore copied only the DB, leaving WAL/SHM and root ownership | Runbook now stops services, removes DB/WAL/SHM, copies backup, chowns UID 1000, runs `PRAGMA integrity_check`, then boots |
| Placeholder secrets could pass production validation | App and seed fail fast on `CHANGE_ME`/short secrets; `.env.example` has `SEED_DEMO=false`; preflight script |
| Demo password printed in logs | Log now prints demo email only; seed no longer returns the password |
| No log rotation | Compose json-file limits added for app, sandbox and Caddy |
| TLS/port mismatch footgun | `scripts/preflight.mjs` checks Origin/Cookie/domain/ports; docs updated |
| Sandbox timeout and stale queue files | Timeout passed through; worker cleans stale `.json/.running/.tmp` files on start and every 5 minutes |
| Migration 2 could abort on legacy orphans | Orphans/dedup deleted before FK rebuild; legacy plaintext headers scrubbed on boot; v1→v2 test |
| `.dockerignore` omitted Chrome profiles / env files | Added `.chrome-*`, `.env*`, logs and transient dirs |

**Still requiring target verification (no Docker daemon here):** image build/start, volume ownership at first mount, Caddy ACME/SSE, sandbox network isolation, backup/restore under Docker, XFF rate-limit behavior behind Caddy.

## G5 — Final acceptance

**Verdict:** CONDITIONAL GO — no confirmed blocking code defect; Docker/queue isolation cannot be executed in this environment.

Verified: 23/23 tests, typecheck clean, build clean, live dev sandbox `4`, docs links/assets resolve.

Remaining HIGH findings were fixed after the gate: suspended assets can no longer be republished by authors (403, test added); expert payloads are now explicitly prompt-only (removed unused skill/connector fields); production sandbox queue was exercised locally (`queue-mode 42`) and remains the Compose path; docs now qualify that the development HTTP worker has network access; stale-run threshold is documented at 15 minutes and the sandbox timeout default is aligned at 6 seconds. `content_hash` update is guarded by schema introspection.

**Target checks still required:** Docker compose build/start, Caddy TLS/SSE, `/jobs` ownership and sandbox `network:none`, volume ownership, backup/restore under Docker, real LLM tool loop and connector secrets, and Aliyun port/origin/cookie posture. See `docs/DEPLOYMENT.md`.

## G6 — v1.1 controlled network & workspace files (2026-11-26)

Three independent reviewers, one per stage; every finding traceable in `docs/DESIGN-network-files.md` §10–11.

| Stage | Reviewer | Verdict | Disposition |
|---|---|---|---|
| Design | adversarial design review | 8 findings, 2 BLOCKER | SSRF flag could unlock private egress → fixed with explicit `allowPrivate:false`; IPv6/NAT64/6to4/Teredo escapes → byte-level global-unicast check; file names in system prompt → removed (count only); `read_file` 100KB vs 8KB contract → paged at 7.6k chars. DNS-rebinding TOCTOU accepted as documented residual risk. |
| Implementation | code & security review | 11 findings, 0 BLOCKER | Cross-member overwrite → 403 + audit; list cap 200 < quota 500 → raised; read-window loop → fixed; `max_chars` truncation → 500–7600; connectors gated by `networkEnabled` and shared 5-request budget; disabled feature removed from nav/page; MIME whitelist; `no-store`; workspace-role-only settings guard; charset decoding; blob downloads. |
| Acceptance | QA acceptance | A / B / C / E PASS, D FAIL (docs) | Stale test counts in `architecture.html` and DESIGN, missing README env/backup notes → fixed. Final: **41/41 tests**. |

Target-machine verification (this host): typecheck clean; 41/41 tests; production build; prod runtime upload → list → text → download → UUID blob on disk; `web_fetch` 200 on example.com and `PRIVATE_URL` for 127.0.0.1 / 169.254.169.254 / [::1] / ::ffff / NAT64 / fe80 / 6to4; Docker Compose rebuild and in-container file round-trip writing under `/app/.data/files` as uid 1000; headless Chrome screenshots of the enabled and disabled Files page with no console errors.

## G7 — v1.2 conversation trace & collapsible reasoning (2026-11-26)

| Stage | Reviewer | Verdict | Disposition |
|---|---|---|---|
| Design | adversarial design review | 8 findings, 1 BLOCKER | Migration v4 guard + `UNIQUE(chat_id, seq)`; trace payload carries `runId`; `reasoning_ms` accumulated per model call; retention fixed to exactly 1000; file names and provider error bodies removed/redacted; truncation metadata added; reasoning block keeps expansion across the silent reload. |
| Implementation | code & security review | 2 HIGH, 4 MED, 8 LOW | Duplicate drawer, chat-switch race, cancel-as-error, reasoning timing on abort, error redaction, idempotent migration, atomic seq, drawer refresh, reasoning live state, key preservation, a11y; all fixed, 4 tests added. |
| Acceptance | QA acceptance | PASS (after fixes) | 45/45 tests, typecheck, build; v3→v4 upgrade verified; UI: 1 overlay, 5 trace rows, "已思考 8.6s · 66 字", 0 console errors. |

Independent QA at 8286260: typecheck clean, 45/45 tests, production build 1.4s, zip clean of secrets, v3→v4 upgrade reproduced (columns + UNIQUE index + 1000-row cap, min seq 101, chat delete cascade), trace route owner-only, meta before trace, abort → cancelled with empty error. UI: collapsed "已思考 8.6s · 66 字", expanded body, single overlay, 5 trace rows, 0 console errors. Blockers: none.

## G8 — v1.3 LLM port & context budget (2026-11-26)

| Stage | Reviewer | Verdict | Disposition |
|---|---|---|---|
| Design | adversarial design review | 8 findings, 2 BLOCKER | 30-row history window → 2000 + token trim; per-call `fitMessages` for tool loops; token-aware pin truncation; adapter per call + numeric config guards; retry jitter/abortable sleep/generic errors; metrics share one window; sandbox flags shared with the test. Step-limit final summary deferred (cost). |
| Implementation | code & security review | 3 HIGH, 7 MED, 4 LOW | Empty/non-SSE stream treated as success; `[DONE]` not ending the read; `model.done` outside finally; duplicated tool names; small-window overflow; timeout spanning the whole generation; cumulative reasoning duplication; terminal-step tools never sent; notice persisted into content; two totals in the drawer. All fixed except export loading state. |
| Acceptance | QA acceptance | PASS (no blockers) | 63/63 tests, typecheck, build 975ms, zip clean of secrets, tag==HEAD, preflight warnings only. Residual: some B/C/D sub-assertions verified at suite level rather than re-read line by line. |

Target verification: 58/58 tests, typecheck clean, production build; live API shows metrics (total/model/tool/first-token) and budget fields; `/trace/export?format=md` returns an attachment; UI drawer renders the four-metric grid and export buttons with 0 console errors.


## G9 — v2.0 UI reset + workspace providers (2026-11-26)

**Design review:** CONDITIONAL. Required: one model resolver that never silently falls from configured workspace models to env keys; encrypted write-only provider keys with AAD; SSRF + redirect protection; default pointer consistency; resolved demo state; accessible native pickers and a member guard. All incorporated or intentionally scoped before implementation.

**Implementation review:** GO after targeted re-review; all four HIGH findings closed.

### Implementation findings and fixes

| Finding | Fix |
|---|---|
| First model could be created disabled and become default; disabling the last enabled model/provider stranded chats with the env fallback suppressed | First model must be enabled; default requires enabled; disabling/deleting the last enabled model or the provider that owns it returns 409 with a clear recovery message; deleting the last remaining model is allowed and reverts to platform default |
| Settings default model and `workspace_models.is_default` had two sources of truth | PATCH settings now clears/sets the partial-unique default inside the same transaction; `workspaceDefaultModel` prefers the persisted setting when valid |
| Undecryptable provider key silently produced demo answers while UI said key saved | Provider/model responses expose `keyError`; runtime fails closed with an actionable error; provider card shows “密钥异常” |
| Provider connection test was not audited | `provider.test` audit records ok/status only, never key or upstream body |

**Verification:** 70/70 tests, typecheck clean, production build; desktop and 390px screenshots for home, capability library, model configuration.


## G10 — v2.1 workbench cleanup & chat management (2026-11-26)

**Scope:** remove the duplicate “新建对话” entry and sidebar recent list; make the Workbench composer the single new-chat entry; add archive/delete to every Home recent chat and a restore/delete view for archived chats.

**Implementation review:** CONDITIONAL → GO after fixes. HIGH-1: chats 6–100 were unreachable after removing sidebar recents → “查看全部” two-tab manager over `/chats?limit=100` and `?archived=1`. HIGH-2: action icons were hover-only/low contrast → always visible, `--muted`, 32px (36px mobile), 4px gap. HIGH-3: archived manager and delete confirmation stacked → manager unmounts while confirmation is open and remounts on cancel/confirm.

**Verification:** 71/71 tests (new archive → hide → restore → delete API regression), typecheck clean, production build; browser probe confirms sidebar has no recent/new-chat duplicate, archive hides the row, archived modal exposes restore, delete uses a confirmation dialog, 0 console errors; desktop and 390px screenshots captured.


## G11 — v2.2 account & security hub (2026-11-26)

**Scope:** remove sidebar entries for models, workspace settings and members; move members into the user-menu “账号与安全” settings module; remove descriptive clutter/duplicate entry points and simplify the page into 工作区 / 成员与权限 / 登录安全 tabs.

**Implementation review:** CONDITIONAL → GO after fixes. HIGH: members exposed admin controls to platform admins without workspace role → workspace role only; file empty-state linked to settings default tab instead of workspace tab → `?tab=workspace`; non-admin toggles were silent no-ops → workspace tab admin-only + `Toggle disabled`; default model had two controls → Models page only; settings save blanked the page → loaded-workspace ref; model page was a nav dead end → breadcrumb + return. Optional stale default PATCH removed.

**Verification:** 71/71 tests, typecheck clean, production build; browser probe confirms sidebar has only 工作/工具 groups, user menu has one settings entry, `/app/members` redirects to the members tab, settings shows three tabs, 0 console errors; desktop screenshots for all three tabs.
