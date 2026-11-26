# AI Workforce OS — MVP design (OrbitWork v2.4)

## Product thesis

> Users state an outcome, not a task list. AI Manager creates a reviewable SOP, organizes AI employees, executes against evidence, and an independent verifier checks the result before a human accepts it.

This module implements the first vertical slice from `AI_Workforce_OS.html`: **software release readiness review**. It is deliberately narrower than the full vision: no Enterprise Work Graph, no arbitrary Runtime, no autonomous production changes, no SOP marketplace.

## Closed loop

```
Goal → AI Manager plan (SOP) → human approves → 7 role-assigned tasks
     → evidence pack → independent verification → human accepts
```

State machine:

- Goal: `planned → approved → running → review → accepted` (`failed` on execution error)
- Run: `approved → running → review → accepted` (`failed`)
- Task: `pending → running → done` (`failed`)

Approval and acceptance are explicit human gates. Run completion is not outcome acceptance.

## MVP scope (P0)

| Capability | Implementation |
|---|---|
| Goal intake | Natural language objective, version/platform extraction, assumptions |
| AI Manager | Deterministic Release Readiness SOP builder + DAG validator |
| SOP review | Plan task list, roles, dependencies, output contracts, success criteria |
| AI Workforce | 7 code-defined employee roles (Release Coordinator, Requirement/Build/Quality Analysts, Evaluator, Report Writer, Independent Verifier) |
| Execution | Sequential dependency-ordered local evidence engine |
| Evidence Store | Per-task evidence rows with source and payload |
| Verifier | Four checks: task completion, evidence coverage, report, independent verification |
| Human acceptance | Only `review` runs can be accepted |
| Work dashboard | Goals, status, progress, roster, accepted rate |

## Deliberate MVP limits

- The release snapshot is a **local deterministic evidence pack** with a persisted `synthetic` flag, surfaced in the plan assumptions. It is not a claim of real Jira/Git/Jenkins data.
- External connectors, full Work Graph, LLM-generated dynamic SOPs, cost tracking and org memory are roadmap items.
- No task writes to production systems.
- This boundary keeps the MVP installable with the existing single-node Docker Compose and testable without external credentials.

## Domain/application boundaries

- `server/domain/workforce.ts`: pure types, goal understanding, plan builder/validator, deterministic evidence engine, verifier. No DB or HTTP.
- `server/application/workforce-service.ts`: persistence, transactions, state transitions, row-to-view mapping.
- `server/http/routes/workforce.ts`: Zod input, workspace authorization, audit, HTTP contracts.
- `workforce_goal.plan_json` is the immutable approved plan snapshot; `workforce_runs.snapshot_json` is the execution input; evidence and verification are append-only records.

## API

- `GET /api/w/:ws/workforce/overview`
- `POST /api/w/:ws/workforce/goals`
- `GET /api/w/:ws/workforce/goals/:goalId`
- `POST /api/w/:ws/workforce/goals/:goalId/approve`
- `POST /api/w/:ws/workforce/runs/:runId/execute`
- `POST /api/w/:ws/workforce/runs/:runId/accept`

All queries are scoped by `workspace_id`; every mutation is audited. Any workspace member can create and read goals. Approval/execution require the goal creator or a workspace admin; acceptance requires a workspace admin. The verifier fails closed on a blocking risk; admins must explicitly accept risk. The synthetic snapshot flag is persisted and surfaced in the UI.

## Data model (migration v7)

- `workforce_goals`: id, workspace, user, objective, status, plan_json, context_json
- `workforce_runs`: id, workspace, goal (unique), user, status, snapshot_json, verification_json, report_md, synthetic, timestamps
- `workforce_tasks`: id, run, task_key, seq, title, role, kind, depends_json, status, output, timestamps
- `workforce_evidence`: id, run, task, title, kind, source, payload_json

## Testing

- Pure domain: goal parsing, plan DAG validation, deterministic task outputs, verifier pass/conditional.
- API integration: goal → approve → execute → review → accept, overview stats, validation, cross-workspace 404.
- Full suite: 76 tests (plus typecheck/build).

## Roadmap after MVP

1. Real connector evidence: Jira/Git/Jenkins/DPLM read adapters.
2. LLM-assisted goal clarification and dynamic SOP proposals, with deterministic guardrails.
3. SOP version library and approval policy.
4. Workspace roles for who can approve/accept; budget/cost tracking.
5. Work Graph business-object relations and organizational memory.
