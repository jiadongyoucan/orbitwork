import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { openDb } from '../server/infrastructure/db.js';
import { resetRates } from '../server/http/rate-limit.js';
import { traceEvent } from '../server/infrastructure/trace.js';

let app: FastifyInstance;
let counter = 0;

type Session = { cookie: string; workspaceId: string };

before(async () => {
  app = await createApp({ dbPath: ':memory:', seed: false, logger: false });
  await app.ready();
});
after(async () => { await app.close(); });
beforeEach(() => resetRates());

async function signup(name = 'Trace User'): Promise<Session> {
  counter += 1;
  resetRates();
  const response = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { name, email: `trace${counter}@example.test`, password: 'CorrectHorse!2026', workspaceName: `${name} 的空间` },
  });
  assert.equal(response.statusCode, 200, response.body);
  const raw = response.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0];
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return { cookie, workspaceId: me.json().workspaces[0].id };
}

async function api<T = any>(session: Session, method: string, url: string, payload?: unknown): Promise<T> {
  const response = await app.inject({
    method: method as 'GET', url,
    headers: { cookie: session.cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url} -> ${response.statusCode} ${response.body}`);
  return response.json() as T;
}

test('trace: a chat run records ordered events and only the owner can read them', async () => {
  const session = await signup();
  const chat = await api<{ chat: { id: string } }>(session, 'POST', `/api/w/${session.workspaceId}/chats`, { title: 'traced' });

  const stream = await app.inject({
    method: 'POST',
    url: `/api/w/${session.workspaceId}/chats/${chat.chat.id}/messages`,
    headers: { cookie: session.cookie, 'content-type': 'application/json', accept: 'text/event-stream' },
    payload: { content: '你好，介绍一下你自己' },
  });
  assert.equal(stream.statusCode, 200, stream.body);
  assert.match(stream.body, /event: trace/);
  assert.ok(stream.body.indexOf('event: meta') < stream.body.indexOf('event: trace'), 'meta must precede trace');

  const trace = await api<{
    events: Array<{ seq: number; kind: string; status: string; detail: Record<string, unknown> }>;
    runs: Array<{ status: string }>;
    totals: { events: number; tokensOut: number };
    metrics: { totalMs: number; modelMs: number; toolMs: number; firstTokenMs: number };
  }>(session, 'GET', `/api/w/${session.workspaceId}/chats/${chat.chat.id}/trace`);
  const kinds = trace.events.map((event) => event.kind);
  for (const expected of ['run.start', 'prompt.ready', 'model.call', 'model.first_token', 'run.done']) {
    assert.ok(kinds.includes(expected), `${expected} missing from ${kinds.join(',')}`);
  }
  const seqs = trace.events.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.ok(trace.totals.events > 0);
  assert.equal(trace.runs[0].status, 'complete');

  const prompt = trace.events.find((event) => event.kind === 'prompt.ready')!;
  assert.ok(Array.isArray((prompt.detail as { tools?: unknown[] }).tools));
  const budget = (prompt.detail as { budget?: { used: number; dropped: number; limit: number } }).budget;
  assert.ok(budget && budget.limit > 0 && budget.used >= 0 && budget.dropped >= 0, 'budget recorded in trace');
  assert.ok(trace.metrics.modelMs > 0, 'model.done feeds model time');
  assert.ok(trace.metrics.totalMs >= trace.metrics.modelMs);
  assert.ok(trace.metrics.firstTokenMs >= 0);
  assert.equal(JSON.stringify(trace.events).includes('你好，介绍一下你自己'), false, 'user content must not be stored in the trace');

  const detail = await api<{ messages: Array<{ role: string; runId: string | null; reasoningMs: number }> }>(
    session, 'GET', `/api/w/${session.workspaceId}/chats/${chat.chat.id}`,
  );
  const assistant = detail.messages.find((message) => message.role === 'assistant');
  assert.ok(assistant?.runId, 'assistant message must reference its run');
  assert.equal(assistant?.reasoningMs, 0);

  const exportMd = await app.inject({
    method: 'GET', url: `/api/w/${session.workspaceId}/chats/${chat.chat.id}/trace/export?format=md`,
    headers: { cookie: session.cookie },
  });
  assert.equal(exportMd.statusCode, 200);
  assert.match(String(exportMd.headers['content-disposition']), /attachment/);
  assert.match(exportMd.body, /\| seq \|/);

  const exportJson = await app.inject({
    method: 'GET', url: `/api/w/${session.workspaceId}/chats/${chat.chat.id}/trace/export?format=json`,
    headers: { cookie: session.cookie },
  });
  assert.equal(exportJson.statusCode, 200);
  const exported = exportJson.json() as { metrics: Record<string, number>; events: unknown[] };
  assert.ok(exported.metrics.modelMs > 0);
  assert.ok(exported.events.length > 0);

  const limited = await api<{ events: unknown[]; truncated: boolean; totalEvents: number }>(
    session, 'GET', `/api/w/${session.workspaceId}/chats/${chat.chat.id}/trace?limit=2`,
  );
  assert.equal(limited.events.length, 2);
  assert.equal(limited.truncated, true);
  assert.ok(limited.totalEvents >= 5);

  const stranger = await signup('Stranger');
  const denied = await app.inject({
    method: 'GET', url: `/api/w/${session.workspaceId}/chats/${chat.chat.id}/trace`,
    headers: { cookie: stranger.cookie },
  });
  assert.equal(denied.statusCode, 404);

  await api(session, 'DELETE', `/api/w/${session.workspaceId}/chats/${chat.chat.id}`);
  const afterDelete = await app.inject({
    method: 'GET', url: `/api/w/${session.workspaceId}/chats/${chat.chat.id}/trace`,
    headers: { cookie: session.cookie },
  });
  assert.equal(afterDelete.statusCode, 404);
});

test('trace: retention keeps the per-chat table bounded', () => {
  const db = openDb(':memory:');
  try {
    db.prepare("INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u','a@b.test','A','x',1)").run();
    db.prepare("INSERT INTO workspaces (id,name,slug,owner_id,settings_json,created_at,updated_at) VALUES ('w','W','w','u','{}',1,1)").run();
    db.prepare("INSERT INTO chats (id,workspace_id,user_id,title,model,created_at,updated_at) VALUES ('c','w','u','t','m',1,1)").run();
    for (let index = 0; index < 1100; index += 1) {
      traceEvent(db, { workspaceId: 'w', chatId: 'c', kind: 'model.call', detail: { index } });
    }
    const count = (db.prepare('SELECT COUNT(*) AS n FROM trace_events WHERE chat_id = ?').get('c') as { n: number }).n;
    assert.ok(count <= 1000, `expected retention cap, got ${count}`);
    const maxSeq = (db.prepare('SELECT MAX(seq) AS n FROM trace_events WHERE chat_id = ?').get('c') as { n: number }).n;
    const minSeq = (db.prepare('SELECT MIN(seq) AS n FROM trace_events WHERE chat_id = ?').get('c') as { n: number }).n;
    assert.equal(maxSeq, 1100);
    assert.equal(minSeq, 101, 'oldest rows are pruned');
  } finally {
    db.close();
  }
});
