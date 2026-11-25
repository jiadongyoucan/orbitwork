import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { json, now } from '../../infrastructure/db.js';
import { audit, requireWorkspace } from '../context.js';
import { badRequest, forbidden, notFound } from '../../domain/errors.js';
import { memoryInputSchema } from '../../domain/schemas.js';

type MemoryRow = {
  id: string;
  agent_id: string | null;
  scope: string;
  title: string;
  content: string;
  tags_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
};

const serialize = (row: MemoryRow) => ({
  id: row.id,
  agentId: row.agent_id,
  scope: row.scope,
  title: row.title,
  content: row.content,
  tags: json<string[]>(row.tags_json, []),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function memoryRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/w/:workspaceId/memories', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { q = '' } = request.query as { q?: string };
    const like = `%${q.trim()}%`;
    const visibility = ctx.role === 'member'
      ? " AND (scope = 'workspace' OR created_by = ?)"
      : '';
    const params: Array<string | number> = [ctx.workspace.id, like, like, like];
    if (ctx.role === 'member') params.push(ctx.user.id);
    const rows = db
      .prepare(
        `SELECT * FROM memories WHERE workspace_id = ? AND (title LIKE ? OR content LIKE ? OR tags_json LIKE ?)${visibility}
         ORDER BY updated_at DESC LIMIT 200`,
      )
      .all(...params) as MemoryRow[];
    return { memories: rows.map(serialize) };
  });

  app.post('/api/w/:workspaceId/memories', async (request) => {
    const ctx = requireWorkspace(request, db);
    const input = memoryInputSchema.parse(request.body ?? {});
    if (input.scope === 'agent') {
      if (!input.agentId) throw badRequest('请选择智能体');
      const agent = db.prepare('SELECT id, created_by FROM agents WHERE id = ? AND workspace_id = ?').get(input.agentId, ctx.workspace.id) as { id: string; created_by: string } | undefined;
      if (!agent) throw badRequest('智能体不存在');
      if (agent.created_by !== ctx.user.id && ctx.role === 'member') throw forbidden('只能为智能体添加自己的记忆');
    }
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO memories (id, workspace_id, agent_id, scope, title, content, tags_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ctx.workspace.id, input.agentId ?? null, input.scope, input.title, input.content, JSON.stringify(input.tags), ctx.user.id, timestamp, timestamp);
    audit(db, ctx.workspace.id, ctx.user.id, 'memory.create', 'memory', id, {}, request.ip);
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow;
    return { memory: serialize(row) };
  });

  app.patch('/api/w/:workspaceId/memories/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT * FROM memories WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as MemoryRow | undefined;
    if (!existing) throw notFound('记忆不存在');
    if (existing.created_by !== ctx.user.id && ctx.role === 'member') throw forbidden('只能修改自己创建的记忆');
    const input = memoryInputSchema.partial().parse(request.body ?? {});
    db.prepare('UPDATE memories SET title = ?, content = ?, tags_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(
      input.title ?? existing.title,
      input.content ?? existing.content,
      JSON.stringify(input.tags ?? json<string[]>(existing.tags_json, [])),
      now(), id, ctx.workspace.id,
    );
    return { ok: true };
  });

  app.delete('/api/w/:workspaceId/memories/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT created_by FROM memories WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as { created_by: string } | undefined;
    if (!existing) throw notFound('记忆不存在');
    if (existing.created_by !== ctx.user.id && ctx.role === 'member') throw forbidden('只能删除自己创建的记忆');
    const result = db.prepare('DELETE FROM memories WHERE id = ? AND workspace_id = ?').run(id, ctx.workspace.id);
    if (result.changes === 0) throw notFound('记忆不存在');
    audit(db, ctx.workspace.id, ctx.user.id, 'memory.delete', 'memory', id, {}, request.ip);
    return { ok: true };
  });
}
