import { randomUUID } from 'node:crypto';
import type { DB } from '../infrastructure/db.js';
import { json, now, tx } from '../infrastructure/db.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import {
  WORKFORCE_ROLES, buildReleasePlan, buildReleaseSnapshot, executeTask, understandGoal, validatePlan, verifyTasks,
  type Evidence, type ReleaseSnapshot, type Risk, type Verification, type WorkPlan,
} from '../domain/workforce.js';

type GoalRow = {
  id: string; workspace_id: string; user_id: string; objective: string; status: string;
  plan_json: string; context_json: string; created_at: number; updated_at: number;
};
type RunRow = {
  id: string; workspace_id: string; goal_id: string; user_id: string; status: string;
  snapshot_json: string; verification_json: string; report_md: string;
  started_at: number | null; finished_at: number | null; accepted_at: number | null; created_at: number; synthetic: number;
};
type TaskRow = {
  id: string; run_id: string; task_key: string; seq: number; title: string; role_id: string;
  role_name: string; kind: string; depends_json: string; status: string; output: string;
  error: string; started_at: number | null; finished_at: number | null;
};
type EvidenceRow = { id: string; run_id: string; task_id: string; title: string; kind: string; source: string; payload_json: string; created_at: number };

export type WorkforceTaskView = {
  id: string; key: string; seq: number; title: string; roleId: string; roleName: string; kind: string;
  dependsOn: string[]; status: string; output: string; error: string; startedAt: number | null; finishedAt: number | null;
  evidence: Evidence[];
};
export type WorkforceRunView = {
  id: string; status: string; createdAt: number; startedAt: number | null; finishedAt: number | null; acceptedAt: number | null;
  report: string; verification: Verification | null; snapshot: ReleaseSnapshot; tasks: WorkforceTaskView[]; synthetic: boolean;
};
export type WorkforceGoalView = {
  id: string; objective: string; status: string; ownerId: string; createdAt: number; updatedAt: number;
  plan: WorkPlan; run: WorkforceRunView | null;
};
export type WorkforceSummary = {
  id: string; objective: string; status: string; createdAt: number;
  taskTotal: number; taskDone: number; runStatus: string | null;
};

function goalFor(db: DB, workspaceId: string, goalId: string): GoalRow {
  const goal = db.prepare('SELECT * FROM workforce_goals WHERE id = ? AND workspace_id = ?').get(goalId, workspaceId) as GoalRow | undefined;
  if (!goal) throw notFound('工作目标不存在');
  return goal;
}

function runFor(db: DB, workspaceId: string, runId: string): RunRow {
  const run = db.prepare('SELECT * FROM workforce_runs WHERE id = ? AND workspace_id = ?').get(runId, workspaceId) as RunRow | undefined;
  if (!run) throw notFound('执行记录不存在');
  return run;
}

function taskViews(db: DB, runId: string): WorkforceTaskView[] {
  const tasks = db.prepare('SELECT * FROM workforce_tasks WHERE run_id = ? ORDER BY seq').all(runId) as TaskRow[];
  const evidence = db.prepare('SELECT * FROM workforce_evidence WHERE run_id = ? ORDER BY created_at').all(runId) as EvidenceRow[];
  return tasks.map((task) => ({
    id: task.id, key: task.task_key, seq: task.seq, title: task.title, roleId: task.role_id, roleName: task.role_name,
    kind: task.kind, dependsOn: json<string[]>(task.depends_json, []), status: task.status, output: task.output,
    error: task.error, startedAt: task.started_at, finishedAt: task.finished_at,
    evidence: evidence.filter((item) => item.task_id === task.id).map((item) => ({
      id: item.id, title: item.title, kind: item.kind, source: item.source, payload: json(item.payload_json, {}),
    })),
  }));
}

function runView(db: DB, run: RunRow): WorkforceRunView {
  return {
    id: run.id, status: run.status, createdAt: run.created_at, startedAt: run.started_at, finishedAt: run.finished_at,
    acceptedAt: run.accepted_at, report: run.report_md, verification: Object.keys(json(run.verification_json, {})).length ? json(run.verification_json, null) : null,
    snapshot: json<ReleaseSnapshot>(run.snapshot_json, buildReleaseSnapshot(understandGoal(''))), tasks: taskViews(db, run.id), synthetic: Boolean(run.synthetic),
  };
}

function detail(db: DB, workspaceId: string, goalId: string): WorkforceGoalView {
  const goal = goalFor(db, workspaceId, goalId);
  const run = db.prepare('SELECT * FROM workforce_runs WHERE goal_id = ? AND workspace_id = ?').get(goal.id, workspaceId) as RunRow | undefined;
  return {
    id: goal.id, objective: goal.objective, status: goal.status, ownerId: goal.user_id, createdAt: goal.created_at, updatedAt: goal.updated_at,
    plan: json<WorkPlan>(goal.plan_json, buildReleasePlan(understandGoal(goal.objective))),
    run: run ? runView(db, run) : null,
  };
}

export function createWorkforceGoal(db: DB, workspaceId: string, userId: string, objective: string): WorkforceGoalView {
  const understanding = understandGoal(objective);
  const plan = buildReleasePlan(understanding);
  const issues = validatePlan(plan);
  if (issues.length) throw badRequest(`工作计划不合法：${issues[0].message}`);
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO workforce_goals (id, workspace_id, user_id, objective, status, plan_json, context_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)`,
  ).run(id, workspaceId, userId, objective.trim(), JSON.stringify(plan), JSON.stringify({ version: understanding.version, platform: understanding.platform }), timestamp, timestamp);
  return detail(db, workspaceId, id);
}

export function listWorkforceGoals(db: DB, workspaceId: string): WorkforceSummary[] {
  const rows = db.prepare(
    `SELECT g.id, g.objective, g.status, g.created_at, r.status AS run_status,
            (SELECT COUNT(*) FROM workforce_tasks t WHERE t.run_id = r.id) AS task_total,
            (SELECT COUNT(*) FROM workforce_tasks t WHERE t.run_id = r.id AND t.status = 'done') AS task_done
     FROM workforce_goals g
     LEFT JOIN workforce_runs r ON r.goal_id = g.id
     WHERE g.workspace_id = ?
     ORDER BY g.created_at DESC LIMIT 30`,
  ).all(workspaceId) as Array<{ id: string; objective: string; status: string; created_at: number; run_status: string | null; task_total: number; task_done: number }>;
  return rows.map((row) => ({ id: row.id, objective: row.objective, status: row.status, createdAt: row.created_at, taskTotal: row.task_total, taskDone: row.task_done, runStatus: row.run_status }));
}

export function workforceOverview(db: DB, workspaceId: string) {
  const goals = listWorkforceGoals(db, workspaceId);
  const total = (db.prepare('SELECT COUNT(*) AS n FROM workforce_goals WHERE workspace_id = ?').get(workspaceId) as { n: number }).n;
  const accepted = (db.prepare("SELECT COUNT(*) AS n FROM workforce_goals WHERE workspace_id = ? AND status = 'accepted'").get(workspaceId) as { n: number }).n;
  const inProgress = (db.prepare("SELECT COUNT(*) AS n FROM workforce_goals WHERE workspace_id = ? AND status IN ('approved','running','review')").get(workspaceId) as { n: number }).n;
  return { goals, roles: WORKFORCE_ROLES, stats: { total, accepted, inProgress, roles: WORKFORCE_ROLES.length, verifiedRate: total ? Math.round((accepted / total) * 100) : 0 } };
}

export function getWorkforceGoal(db: DB, workspaceId: string, goalId: string): WorkforceGoalView {
  return detail(db, workspaceId, goalId);
}

export function approveWorkforceGoal(db: DB, workspaceId: string, goalId: string, userId: string): WorkforceGoalView {
  const goal = goalFor(db, workspaceId, goalId);
  const existing = db.prepare('SELECT id FROM workforce_runs WHERE goal_id = ?').get(goal.id) as { id: string } | undefined;
  if (existing) return detail(db, workspaceId, goal.id);
  if (goal.status !== 'planned') throw conflict('该工作目标当前不可审批');
  const plan = json<WorkPlan>(goal.plan_json, buildReleasePlan(understandGoal(goal.objective)));
  const issues = validatePlan(plan);
  if (issues.length) throw conflict(`计划存在依赖问题：${issues[0].message}`);
  const runId = randomUUID();
  const timestamp = now();
  const snapshot = buildReleaseSnapshot(understandGoal(goal.objective));
  tx(db, () => {
    db.prepare(
      `INSERT INTO workforce_runs (id, workspace_id, goal_id, user_id, status, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, 'approved', ?, ?)`,
    ).run(runId, workspaceId, goal.id, userId, JSON.stringify(snapshot), timestamp);
    for (const task of plan.tasks) {
      db.prepare(
        `INSERT INTO workforce_tasks (id, run_id, task_key, seq, title, role_id, role_name, kind, depends_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      ).run(randomUUID(), runId, task.id, task.seq, task.title, task.roleId, task.roleName, task.kind, JSON.stringify(task.dependsOn));
    }
    db.prepare("UPDATE workforce_goals SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, goal.id);
  });
  return detail(db, workspaceId, goal.id);
}

export function executeWorkforceRun(db: DB, workspaceId: string, runId: string): WorkforceGoalView {
  const run = runFor(db, workspaceId, runId);
  if (run.status === 'accepted') throw conflict('已验收的执行不能重新运行');
  if (run.status === 'running') throw conflict('执行正在进行中');
  const goal = goalFor(db, workspaceId, run.goal_id);
  if (run.status === 'review') return detail(db, workspaceId, goal.id);
  const start = now();
  db.prepare("UPDATE workforce_runs SET status = 'running', started_at = ? WHERE id = ?").run(start, run.id);
  db.prepare("UPDATE workforce_goals SET status = 'running', updated_at = ? WHERE id = ?").run(start, goal.id);
  const snapshot = json<ReleaseSnapshot>(run.snapshot_json, buildReleaseSnapshot(understandGoal(goal.objective)));
  const tasks = db.prepare('SELECT * FROM workforce_tasks WHERE run_id = ? ORDER BY seq').all(run.id) as TaskRow[];
  try {
    for (const task of tasks) {
      if (task.status === 'done') continue;
      const taskStart = now();
      db.prepare("UPDATE workforce_tasks SET status = 'running', started_at = ? WHERE id = ?").run(taskStart, task.id);
      let result: ReturnType<typeof executeTask>;
      try {
        result = executeTask(task.kind as Parameters<typeof executeTask>[0], snapshot);
      } catch (error) {
        db.prepare("UPDATE workforce_tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error instanceof Error ? error.message : '任务执行失败', now(), task.id);
        throw error;
      }
      const finished = now();
      db.prepare("UPDATE workforce_tasks SET status = 'done', output = ?, finished_at = ? WHERE id = ?").run(result.output, finished, task.id);
      for (const item of result.evidence) {
        db.prepare(
          `INSERT INTO workforce_evidence (id, run_id, task_id, title, kind, source, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), run.id, task.id, item.title, item.kind, item.source, JSON.stringify(item.payload), finished);
      }
    }
    const doneTasks = taskViews(db, run.id);
    const verification = verifyTasks(doneTasks.map((task) => ({ status: task.status, evidence: task.evidence, kind: task.kind })));
    const report = doneTasks.find((task) => task.kind === 'report')?.output ?? '';
    const finished = now();
    tx(db, () => {
      db.prepare("UPDATE workforce_runs SET status = 'review', finished_at = ?, verification_json = ?, report_md = ? WHERE id = ?").run(finished, JSON.stringify(verification), report, run.id);
      db.prepare("UPDATE workforce_goals SET status = 'review', updated_at = ? WHERE id = ?").run(finished, goal.id);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '执行失败';
    db.prepare("UPDATE workforce_runs SET status = 'failed', finished_at = ? WHERE id = ?").run(now(), run.id);
    db.prepare("UPDATE workforce_goals SET status = 'failed', updated_at = ? WHERE id = ?").run(now(), goal.id);
    throw badRequest(`执行失败：${message}`);
  }
  return detail(db, workspaceId, goal.id);
}

export function acceptWorkforceRun(db: DB, workspaceId: string, runId: string, acceptRisk = false, overrideReason = ''): WorkforceGoalView {
  const run = runFor(db, workspaceId, runId);
  const goal = goalFor(db, workspaceId, run.goal_id);
  if (run.status === 'accepted') return detail(db, workspaceId, goal.id);
  if (run.status !== 'review') throw conflict('只有待验收的执行可以确认');
  const verification = json<Verification | null>(run.verification_json, null);
  if (verification?.verdict !== 'pass' && !acceptRisk) throw conflict('独立验证未通过；请处理阻断风险，或由管理员显式接受风险');
  if (verification?.verdict !== 'pass' && !overrideReason.trim()) throw badRequest('接受风险需要填写原因');
  const timestamp = now();
  tx(db, () => {
    db.prepare("UPDATE workforce_runs SET status = 'accepted', accepted_at = ?, verification_json = ? WHERE id = ?").run(timestamp, JSON.stringify({ ...(verification ?? {}), acceptedRisk: verification?.verdict !== 'pass', overrideReason: overrideReason.trim() }), run.id);
    db.prepare("UPDATE workforce_goals SET status = 'accepted', updated_at = ? WHERE id = ?").run(timestamp, goal.id);
  });
  return detail(db, workspaceId, goal.id);
}

export function workforceRisks(tasks: WorkforceTaskView[]): Risk[] {
  const evidence = tasks.flatMap((task) => task.evidence).find((item) => item.kind === 'risk-assessment');
  return Array.isArray(evidence?.payload) ? evidence.payload as Risk[] : [];
}

/** A synchronous local executor cannot legitimately leave a run in `running`
 * across process boot; reconcile it to a retryable failed state. */
export function reconcileWorkforceRuns(db: DB): void {
  const running = db.prepare("SELECT id, goal_id FROM workforce_runs WHERE status = 'running'").all() as Array<{ id: string; goal_id: string }>;
  for (const run of running) {
    db.prepare("UPDATE workforce_runs SET status = 'failed', finished_at = ? WHERE id = ?").run(now(), run.id);
    db.prepare("UPDATE workforce_goals SET status = 'failed', updated_at = ? WHERE id = ?").run(now(), run.goal_id);
  }
}
