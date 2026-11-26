import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { resetRates } from '../server/http/rate-limit.js';
import { buildReleasePlan, buildReleaseSnapshot, executeTask, understandGoal, validatePlan, verifyTasks } from '../server/domain/workforce.js';

let app: FastifyInstance;
let counter = 0;

before(async () => {
  app = await createApp({ dbPath: ':memory:', seed: false, logger: false });
  await app.ready();
});
after(async () => { await app.close(); });

async function signup(name = 'Workforce User'): Promise<{ cookie: string; workspaceId: string; email: string }> {
  counter += 1;
  resetRates();
  const response = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { name, email: `wf${counter}@example.test`, password: 'CorrectHorse!2026', workspaceName: `WF ${counter}` },
  });
  assert.equal(response.statusCode, 200, response.body);
  const raw = response.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return { cookie, workspaceId: me.json().workspaces[0].id, email: `wf${counter}@example.test` };
}

async function call(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({ method: method as any, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as any }) });
}

test('workforce domain: goal understanding, plan DAG and deterministic evidence', () => {
  const goal = understandGoal('分析 星图平台 V2.4 本周发布风险，输出管理评审报告');
  assert.equal(goal.version, 'V2.4');
  assert.equal(goal.platform, '星图平台');
  const plan = buildReleasePlan(goal);
  assert.equal(plan.tasks.length, 7);
  assert.deepEqual(validatePlan(plan), []);
  const snapshot = buildReleaseSnapshot(goal);
  const profile = executeTask('profile', snapshot);
  const risk = executeTask('risk', snapshot);
  const report = executeTask('report', snapshot);
  assert.match(profile.output, /V2\.4/);
  assert.match(risk.output, /Blocker/);
  assert.match(report.output, /发布准备度评审/);
});

test('workforce domain: verifier fails when evidence is missing and passes when complete', () => {
  const goal = understandGoal('分析 V2.4 发布风险');
  const snapshot = buildReleaseSnapshot(goal);
  const plan = buildReleasePlan(goal);
  const tasks = plan.tasks.map((task) => {
    const result = executeTask(task.kind, snapshot);
    return { status: 'done', kind: task.kind, evidence: result.evidence.map((item, index) => ({ id: `${task.id}-${index}`, ...item })) };
  });
  assert.equal(verifyTasks(tasks).verdict, 'conditional');
  assert.equal(verifyTasks(tasks.map((task, index) => index === 0 ? { ...task, evidence: [] } : task)).verdict, 'conditional');
});

test('workforce API: goal → plan approval → execution → verification → human acceptance', async () => {
  const owner = await signup();
  const created = await call('POST', `/api/w/${owner.workspaceId}/workforce/goals`, owner.cookie, { objective: '分析星图平台 V2.4 本周发布风险，输出管理评审报告' });
  assert.equal(created.statusCode, 200, created.body);
  const goal = created.json().goal;
  assert.equal(goal.status, 'planned');
  assert.equal(goal.plan.tasks.length, 7);

  const approved = await call('POST', `/api/w/${owner.workspaceId}/workforce/goals/${goal.id}/approve`, owner.cookie);
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().goal.status, 'approved');
  assert.equal(approved.json().goal.run.status, 'approved');
  assert.equal(approved.json().goal.run.tasks.length, 7);

  const executed = await call('POST', `/api/w/${owner.workspaceId}/workforce/runs/${approved.json().goal.run.id}/execute`, owner.cookie);
  assert.equal(executed.statusCode, 200, executed.body);
  const run = executed.json().goal.run;
  assert.equal(run.status, 'review');
  assert.equal(run.tasks.every((task: any) => task.status === 'done'), true);
  assert.equal(run.verification.verdict, 'conditional');
  assert.match(run.report, /发布准备度评审/);
  assert.ok(run.tasks.flatMap((task: any) => task.evidence).length >= 7);

  const blocked = await call('POST', `/api/w/${owner.workspaceId}/workforce/runs/${run.id}/accept`, owner.cookie);
  assert.equal(blocked.statusCode, 409);
  const noReason = await call('POST', `/api/w/${owner.workspaceId}/workforce/runs/${run.id}/accept`, owner.cookie, { acceptRisk: true });
  assert.equal(noReason.statusCode, 400);
  const accepted = await call('POST', `/api/w/${owner.workspaceId}/workforce/runs/${run.id}/accept`, owner.cookie, { acceptRisk: true, overrideReason: '业务负责人确认接受风险，发布窗口另行评估' });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().goal.status, 'accepted');
  assert.equal(accepted.json().goal.run.status, 'accepted');

  const overview = await call('GET', `/api/w/${owner.workspaceId}/workforce/overview`, owner.cookie);
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().stats.accepted, 1);
  assert.equal(overview.json().stats.roles, 7);
});

test('workforce API: validates objective and isolates workspaces', async () => {
  const owner = await signup();
  const other = await signup();
  const invalid = await call('POST', `/api/w/${owner.workspaceId}/workforce/goals`, owner.cookie, { objective: 'x' });
  assert.equal(invalid.statusCode, 400);
  const created = await call('POST', `/api/w/${owner.workspaceId}/workforce/goals`, owner.cookie, { objective: '分析 V3.1 发布风险并输出报告' });
  const goalId = created.json().goal.id;
  const cross = await call('GET', `/api/w/${other.workspaceId}/workforce/goals/${goalId}`, other.cookie);
  assert.equal(cross.statusCode, 404);
});

test('workforce API: members can read workspace goals but only owner/admin can mutate', async () => {
  const owner = await signup();
  const member = await signup();
  const invite = await call('POST', `/api/w/${owner.workspaceId}/invites`, owner.cookie, { email: member.email, role: 'member' });
  assert.equal(invite.statusCode, 200, invite.body);
  const token = invite.json().inviteUrl.split('/').pop();
  const accepted = await call('POST', `/api/invites/${token}/accept`, member.cookie);
  assert.equal(accepted.statusCode, 200, accepted.body);
  const created = await call('POST', `/api/w/${owner.workspaceId}/workforce/goals`, owner.cookie, { objective: '分析 V3.1 发布风险并输出报告' });
  const goalId = created.json().goal.id;
  const read = await call('GET', `/api/w/${owner.workspaceId}/workforce/goals/${goalId}`, member.cookie);
  assert.equal(read.statusCode, 200);
  const forbidden = await call('POST', `/api/w/${owner.workspaceId}/workforce/goals/${goalId}/approve`, member.cookie);
  assert.equal(forbidden.statusCode, 403);
});
