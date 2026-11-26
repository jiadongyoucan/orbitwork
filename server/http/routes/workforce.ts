import type { FastifyInstance } from 'fastify';
import type { DB } from '../../infrastructure/db.js';
import { audit, requireWorkspace } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../../domain/errors.js';
import { workforceGoalInputSchema } from '../../domain/schemas.js';
import {
  acceptWorkforceRun, approveWorkforceGoal, createWorkforceGoal, executeWorkforceRun,
  getWorkforceGoal, workforceOverview, workforceRisks,
} from '../../application/workforce-service.js';

function requireGoalMutation(db: DB, ctx: { user: { id: string }; role: string; workspace: { id: string } }, goalId: string): void {
  const goal = db.prepare('SELECT user_id FROM workforce_goals WHERE id = ? AND workspace_id = ?').get(goalId, ctx.workspace.id) as { user_id: string } | undefined;
  if (!goal) throw notFound('工作目标不存在');
  if (ctx.role === 'member' && goal.user_id !== ctx.user.id) throw forbidden('只有工作发起人或管理员可以执行此操作');
}

function requireRunMutation(db: DB, ctx: { user: { id: string }; role: string; workspace: { id: string } }, runId: string): void {
  const goal = db.prepare('SELECT g.user_id FROM workforce_runs r JOIN workforce_goals g ON g.id = r.goal_id WHERE r.id = ? AND r.workspace_id = ?').get(runId, ctx.workspace.id) as { user_id: string } | undefined;
  if (!goal) throw notFound('执行记录不存在');
  if (ctx.role === 'member' && goal.user_id !== ctx.user.id) throw forbidden('只有工作发起人或管理员可以执行此操作');
}

export async function workforceRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/w/:workspaceId/workforce/overview', async (request) => {
    const ctx = requireWorkspace(request, db);
    return workforceOverview(db, ctx.workspace.id);
  });

  app.post('/api/w/:workspaceId/workforce/goals', async (request) => {
    const ctx = requireWorkspace(request, db);
    const input = workforceGoalInputSchema.parse(request.body ?? {});
    const goal = createWorkforceGoal(db, ctx.workspace.id, ctx.user.id, input.objective);
    audit(db, ctx.workspace.id, ctx.user.id, 'workforce.goal.create', 'workforce_goal', goal.id, { objective: input.objective.slice(0, 120) }, request.ip);
    return { goal };
  });

  app.get('/api/w/:workspaceId/workforce/goals/:goalId', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { goalId } = request.params as { goalId: string };
    return { goal: getWorkforceGoal(db, ctx.workspace.id, goalId) };
  });

  app.post('/api/w/:workspaceId/workforce/goals/:goalId/approve', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { goalId } = request.params as { goalId: string };
    requireGoalMutation(db, ctx, goalId);
    const approved = approveWorkforceGoal(db, ctx.workspace.id, goalId, ctx.user.id);
    audit(db, ctx.workspace.id, ctx.user.id, 'workforce.goal.approve', 'workforce_goal', goalId, {}, request.ip);
    return { goal: approved };
  });

  app.post('/api/w/:workspaceId/workforce/runs/:runId/execute', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { runId } = request.params as { runId: string };
    requireRunMutation(db, ctx, runId);
    const goal = executeWorkforceRun(db, ctx.workspace.id, runId);
    audit(db, ctx.workspace.id, ctx.user.id, 'workforce.run.execute', 'workforce_run', runId, { goalId: goal.id }, request.ip);
    return { goal };
  });

  app.post('/api/w/:workspaceId/workforce/runs/:runId/accept', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { runId } = request.params as { runId: string };
    requireRunMutation(db, ctx, runId);
    const body = (request.body ?? {}) as { acceptRisk?: unknown; overrideReason?: unknown };
    if (body.acceptRisk !== undefined && typeof body.acceptRisk !== 'boolean') throw badRequest('acceptRisk 必须为布尔值');
    if (body.overrideReason !== undefined && (typeof body.overrideReason !== 'string' || body.overrideReason.length > 500)) throw badRequest('overrideReason 不合法');
    const goal = acceptWorkforceRun(db, ctx.workspace.id, runId, body.acceptRisk === true, typeof body.overrideReason === 'string' ? body.overrideReason : '');
    audit(db, ctx.workspace.id, ctx.user.id, 'workforce.run.accept', 'workforce_run', runId, { goalId: goal.id, acceptedRisk: body.acceptRisk === true, overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason.trim().slice(0, 300) : '' }, request.ip);
    return { goal };
  });

  app.get('/api/w/:workspaceId/workforce/runs/:runId/risks', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { runId } = request.params as { runId: string };
    const run = db.prepare('SELECT g.id FROM workforce_runs r JOIN workforce_goals g ON g.id = r.goal_id WHERE r.id = ? AND r.workspace_id = ?').get(runId, ctx.workspace.id) as { id: string } | undefined;
    if (!run) throw notFound('执行记录不存在');
    const goal = getWorkforceGoal(db, ctx.workspace.id, run.id);
    return { risks: goal.run ? workforceRisks(goal.run.tasks) : [] };
  });
}
