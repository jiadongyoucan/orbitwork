import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { json, now } from '../../infrastructure/db.js';
import { audit, requireWorkspace } from '../context.js';
import { badRequest, conflict, notFound } from '../../domain/errors.js';
import { chatInputSchema, messageInputSchema } from '../../domain/schemas.js';
import { assertModel, createRun, ensureChat, runAgent, cancelRun, expireStaleRuns, isRunActive, type RuntimeEvent } from '../../application/agent-runtime.js';
import { checkRateKey } from '../rate-limit.js';
import { defaultModel, models } from '../../config.js';
import { listTrace } from '../../infrastructure/trace.js';

function sse(reply: FastifyReply, seq: { value: number }, event: RuntimeEvent | { type: string; [key: string]: unknown }) {
  seq.value += 1;
  const payload = JSON.stringify(event);
  reply.raw.write(`id: ${seq.value}\nevent: ${event.type}\ndata: ${payload}\n\n`);
}

export async function chatRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/w/:workspaceId/chats', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { q = '', archived = '0' } = request.query as { q?: string; archived?: string };
    const rows = db
      .prepare(
        `SELECT c.id, c.title, c.model, c.agent_id, c.pinned, c.archived, c.created_at, c.updated_at,
                a.name as agent_name, a.icon as agent_icon,
                (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count
         FROM chats c LEFT JOIN agents a ON a.id = c.agent_id
         WHERE c.workspace_id = ? AND c.user_id = ? AND c.archived = ? AND c.title LIKE ?
         ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 100`,
      )
      .all(ctx.workspace.id, ctx.user.id, archived === '1' ? 1 : 0, `%${q.trim()}%`);
    return { chats: rows };
  });

  app.post('/api/w/:workspaceId/chats', async (request) => {
    const ctx = requireWorkspace(request, db);
    const input = chatInputSchema.parse(request.body ?? {});
    let agentId: string | null = null;
    let agentModel = '';
    if (input.agentId) {
      const agent = db.prepare('SELECT id, model FROM agents WHERE id = ? AND workspace_id = ?').get(input.agentId, ctx.workspace.id) as
        | { id: string; model: string }
        | undefined;
      if (!agent) throw badRequest('智能体不存在');
      agentId = agent.id;
      agentModel = agent.model;
    }
    const requested = input.model || agentModel || String(ctx.workspace.settings.defaultModel ?? '') || defaultModel();
    const model = assertModel(requested);
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO chats (id, workspace_id, user_id, agent_id, title, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ctx.workspace.id, ctx.user.id, agentId, input.title || '新会话', model, timestamp, timestamp);
    audit(db, ctx.workspace.id, ctx.user.id, 'chat.create', 'chat', id, {}, request.ip);
    return { chat: { id, title: input.title || '新会话', agentId, model } };
  });

  app.get('/api/w/:workspaceId/chats/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND workspace_id = ? AND user_id = ?').get(id, ctx.workspace.id, ctx.user.id);
    if (!chat) throw notFound('会话不存在');
    const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND workspace_id = ? ORDER BY created_at ASC LIMIT 300').all(id, ctx.workspace.id) as Array<Record<string, unknown> & { tool_events_json: string }>;
    const messages = rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      reasoning: row.reasoning,
      toolEvents: json(row.tool_events_json, []),
      status: row.status,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningMs: row.reasoning_ms ?? 0,
      runId: row.run_id ?? null,
      createdAt: row.created_at,
    }));
    const agent = (chat as { agent_id: string | null }).agent_id
      ? db.prepare('SELECT id, name, icon, description, model FROM agents WHERE id = ?').get((chat as { agent_id: string }).agent_id)
      : null;
    const runs = db.prepare('SELECT id, status, model, started_at, finished_at FROM runs WHERE chat_id = ? ORDER BY started_at DESC LIMIT 10').all(id);
    return { chat, messages, agent, runs };
  });

  app.patch('/api/w/:workspaceId/chats/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const chat = ensureChat(db, ctx.workspace.id, id, ctx.user.id);
    const input = request.body as { title?: string; pinned?: boolean; archived?: boolean };
    if (input.title !== undefined && (!input.title.trim() || input.title.length > 120)) throw badRequest('标题不合法');
    db.prepare('UPDATE chats SET title = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND user_id = ?').run(
      input.title?.trim() ?? chat.title,
      input.pinned === undefined ? (db.prepare('SELECT pinned FROM chats WHERE id = ?').get(id) as { pinned: number }).pinned : input.pinned ? 1 : 0,
      input.archived === undefined ? (db.prepare('SELECT archived FROM chats WHERE id = ?').get(id) as { archived: number }).archived : input.archived ? 1 : 0,
      now(), id, ctx.workspace.id, ctx.user.id,
    );
    return { ok: true };
  });

  app.delete('/api/w/:workspaceId/chats/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    ensureChat(db, ctx.workspace.id, id, ctx.user.id);
    db.prepare('DELETE FROM chats WHERE id = ? AND workspace_id = ? AND user_id = ?').run(id, ctx.workspace.id, ctx.user.id);
    audit(db, ctx.workspace.id, ctx.user.id, 'chat.delete', 'chat', id, {}, request.ip);
    return { ok: true };
  });

  app.post('/api/w/:workspaceId/chats/:id/messages', async (request, reply) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const chat = ensureChat(db, ctx.workspace.id, id, ctx.user.id);
    const input = messageInputSchema.parse(request.body ?? {});
    checkRateKey(`chat:${ctx.user.id}`, 12, 60_000);
    expireStaleRuns(db, isRunActive);
    const running = db.prepare("SELECT id FROM runs WHERE chat_id = ? AND status = 'running'").get(id);
    if (running) throw conflict('该会话正在生成回复，请稍候或取消当前运行');
    const userMessageId = randomUUID();
    const timestamp = now();
    const model = assertModel(chat.model || defaultModel());
    const runId = createRun(db, ctx, { ...chat, model }, model);
    db.prepare(
      `INSERT INTO messages (id, chat_id, workspace_id, role, content, status, model, created_at)
       VALUES (?, ?, ?, 'user', ?, 'complete', ?, ?)`,
    ).run(userMessageId, chat.id, ctx.workspace.id, input.content, model, timestamp);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(timestamp, chat.id);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const seq = { value: 0 };
    let closed = false;
    let finished = false;
    const controller = new AbortController();
    const ping = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, 15_000);
    const abort = () => {
      if (!finished) controller.abort();
    };
    request.raw.on('aborted', abort);
    reply.raw.on('close', () => {
      closed = true;
      if (!finished) controller.abort();
    });

    try {
      reply.raw.write(': connected\n\n');
      await runAgent({
        db, ctx, chat, content: input.content, userMessageId, runId, signal: controller.signal,
        emit: (event) => {
          if (!closed) {
            try {
              sse(reply, seq, event);
            } catch {
              closed = true;
            }
          }
        },
      });
    } catch (error) {
      if (!closed) sse(reply, seq, { type: 'error', message: (error as Error).message });
      db.prepare('UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run('error', (error as Error).message, now(), runId);
    } finally {
      finished = true;
      clearInterval(ping);
      if (!closed) reply.raw.end();
    }
  });

  app.post('/api/w/:workspaceId/runs/:runId/cancel', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { runId } = request.params as { runId: string };
    const run = db.prepare("SELECT id FROM runs WHERE id = ? AND workspace_id = ? AND user_id = ? AND status = 'running'").get(runId, ctx.workspace.id, ctx.user.id);
    if (!run) throw notFound('运行不存在或已结束');
    const cancelled = cancelRun(runId);
    if (!cancelled) {
      db.prepare("UPDATE runs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), runId);
    }
    return { ok: true };
  });

  app.get('/api/w/:workspaceId/runs', async (request) => {
    const ctx = requireWorkspace(request, db);
    const rows = db
      .prepare('SELECT id, chat_id, status, model, tokens_in, tokens_out, started_at, finished_at FROM runs WHERE workspace_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT 30')
      .all(ctx.workspace.id, ctx.user.id);
    return { runs: rows, models: models() };
  });

function loadTracePayload(db: DB, workspaceId: string, userId: string, chatId: string, limit: number) {
  const chat = db
    .prepare('SELECT id FROM chats WHERE id = ? AND workspace_id = ? AND user_id = ?')
    .get(chatId, workspaceId, userId);
  if (!chat) throw notFound('会话不存在');

  const runs = db
    .prepare('SELECT id, status, model, tokens_in, tokens_out, error, started_at, finished_at FROM runs WHERE chat_id = ? AND workspace_id = ? ORDER BY started_at DESC LIMIT 20')
    .all(chatId, workspaceId) as Array<{
      id: string; status: string; model: string; tokens_in: number; tokens_out: number;
      error: string; started_at: number; finished_at: number | null;
    }>;
  const events = listTrace(db, workspaceId, chatId, limit);
  const totalEvents = (db.prepare('SELECT COUNT(*) AS n FROM trace_events WHERE chat_id = ? AND workspace_id = ?').get(chatId, workspaceId) as { n: number }).n;

  const totals = runs.reduce(
    (accumulator, run) => {
      accumulator.durationMs += (run.finished_at ?? now()) - run.started_at;
      if (run.status === 'error') accumulator.errors += 1;
      return accumulator;
    },
    { events: events.length, durationMs: 0, errors: 0 },
  );
  const sumOf = (kind: string) => events.filter((event) => event.kind === kind).reduce((sum, event) => sum + event.durationMs, 0);

  return {
    runs: runs.map((run) => ({
      id: run.id, status: run.status, model: run.model,
      tokensIn: run.tokens_in, tokensOut: run.tokens_out, error: run.error,
      startedAt: run.started_at, finishedAt: run.finished_at,
    })),
    events,
    totals: {
      ...totals,
      tokensIn: runs.reduce((sum, run) => sum + run.tokens_in, 0),
      tokensOut: runs.reduce((sum, run) => sum + run.tokens_out, 0),
    },
    metrics: {
      // All four figures come from the same trace window so they add up.
      totalMs: sumOf('run.done'),
      modelMs: sumOf('model.done'),
      toolMs: sumOf('tool.call'),
      firstTokenMs: [...events].reverse().find((event) => event.kind === 'model.first_token')?.durationMs ?? 0,
    },
    truncated: totalEvents > events.length,
    totalEvents,
  };
}

function renderTraceMarkdown(payload: ReturnType<typeof loadTracePayload>, chatId: string): string {
  const escape = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\r?\n/g, ' ');
  return [
    `# 对话轨迹 ${chatId}`,
    '',
    `- 运行：${payload.runs.length} 次`,
    `- 总耗时：${(payload.metrics.totalMs / 1000).toFixed(2)}s`,
    `- 模型耗时：${(payload.metrics.modelMs / 1000).toFixed(2)}s`,
    `- 工具耗时：${(payload.metrics.toolMs / 1000).toFixed(2)}s`,
    `- 首 token：${payload.metrics.firstTokenMs}ms`,
    `- tokens：${payload.totals.tokensIn} in / ${payload.totals.tokensOut} out`,
    '',
    '| seq | 时间 | 类型 | 状态 | 耗时 | 细节 |',
    '|---|---|---|---|---|---|',
    ...payload.events.map((event) => `| ${event.seq} | ${new Date(event.at).toISOString()} | ${event.kind} | ${event.status} | ${event.durationMs}ms | \`${escape(JSON.stringify(event.detail))}\` |`),
  ].join('\n');
}

  app.get('/api/w/:workspaceId/chats/:id/trace', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const limit = Math.min(Math.max(Number((request.query as { limit?: string }).limit ?? 200), 1), 500);
    return loadTracePayload(db, ctx.workspace.id, ctx.user.id, id, limit);
  });

  app.get('/api/w/:workspaceId/chats/:id/trace/export', async (request, reply) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const format = (request.query as { format?: string }).format === 'md' ? 'md' : 'json';
    const payload = loadTracePayload(db, ctx.workspace.id, ctx.user.id, id, 500);
    const filename = `orbitwork-trace-${id.slice(0, 8)}.${format}`;
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('content-type', format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8');
    return format === 'md' ? renderTraceMarkdown(payload, id) : JSON.stringify(payload, null, 2);
  });
}
