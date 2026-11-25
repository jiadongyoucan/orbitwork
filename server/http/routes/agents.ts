import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { json, now } from '../../infrastructure/db.js';
import { audit, requireWorkspace } from '../context.js';
import { badRequest, conflict, notFound } from '../../domain/errors.js';
import { agentInputSchema } from '../../domain/schemas.js';
import { models } from '../../config.js';

type AgentRow = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  icon: string;
  color: string;
  skill_ids_json: string;
  connector_ids_json: string;
  memory_enabled: number;
  sandbox_enabled: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

function serializeAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    model: row.model,
    icon: row.icon,
    color: row.color,
    skillIds: json<string[]>(row.skill_ids_json, []),
    connectorIds: json<string[]>(row.connector_ids_json, []),
    memoryEnabled: Boolean(row.memory_enabled),
    sandboxEnabled: Boolean(row.sandbox_enabled),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateRelations(db: DB, workspaceId: string, skillIds: string[], connectorIds: string[]) {
  for (const id of skillIds) {
    const row = db.prepare("SELECT id FROM assets WHERE id = ? AND workspace_id = ? AND kind = 'skill'").get(id, workspaceId);
    if (!row) throw badRequest('包含无效的技能');
  }
  for (const id of connectorIds) {
    const row = db.prepare("SELECT id FROM assets WHERE id = ? AND workspace_id = ? AND kind = 'connector'").get(id, workspaceId);
    if (!row) throw badRequest('包含无效的连接器');
  }
}

export async function agentRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/w/:workspaceId/agents', async (request) => {
    const ctx = requireWorkspace(request, db);
    const rows = db
      .prepare('SELECT * FROM agents WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(ctx.workspace.id) as AgentRow[];
    return { agents: rows.map(serializeAgent) };
  });

  app.get('/api/w/:workspaceId/agents/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as AgentRow | undefined;
    if (!row) throw notFound('智能体不存在');
    return { agent: serializeAgent(row) };
  });

  app.post('/api/w/:workspaceId/agents', async (request) => {
    const ctx = requireWorkspace(request, db);
    const input = agentInputSchema.parse(request.body ?? {});
    if (input.model && !models().some((m) => m.id === input.model)) throw badRequest('模型不在允许列表内');
    validateRelations(db, ctx.workspace.id, input.skillIds, input.connectorIds);
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO agents (id, workspace_id, name, description, system_prompt, model, icon, color,
        skill_ids_json, connector_ids_json, memory_enabled, sandbox_enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, ctx.workspace.id, input.name, input.description, input.systemPrompt, input.model ?? '',
      input.icon, input.color, JSON.stringify(input.skillIds), JSON.stringify(input.connectorIds),
      input.memoryEnabled ? 1 : 0, input.sandboxEnabled ? 1 : 0, ctx.user.id, timestamp, timestamp,
    );
    audit(db, ctx.workspace.id, ctx.user.id, 'agent.create', 'agent', id, { name: input.name }, request.ip);
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow;
    return { agent: serializeAgent(row) };
  });

  app.patch('/api/w/:workspaceId/agents/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as AgentRow | undefined;
    if (!existing) throw notFound('智能体不存在');
    if (existing.created_by !== ctx.user.id && ctx.role === 'member') throw conflict('只能修改自己创建的智能体');
    const patch = agentInputSchema.partial().parse(request.body ?? {});
    if (patch.model && !models().some((m) => m.id === patch.model)) throw badRequest('模型不在允许列表内');
    if (patch.skillIds || patch.connectorIds) {
      validateRelations(db, ctx.workspace.id, patch.skillIds ?? [], patch.connectorIds ?? []);
    }
    db.prepare(
      `UPDATE agents SET name = ?, description = ?, system_prompt = ?, model = ?, icon = ?, color = ?,
        skill_ids_json = ?, connector_ids_json = ?, memory_enabled = ?, sandbox_enabled = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      patch.systemPrompt ?? existing.system_prompt,
      patch.model ?? existing.model,
      patch.icon ?? existing.icon,
      patch.color ?? existing.color,
      JSON.stringify(patch.skillIds ?? json<string[]>(existing.skill_ids_json, [])),
      JSON.stringify(patch.connectorIds ?? json<string[]>(existing.connector_ids_json, [])),
      (patch.memoryEnabled ?? Boolean(existing.memory_enabled)) ? 1 : 0,
      (patch.sandboxEnabled ?? Boolean(existing.sandbox_enabled)) ? 1 : 0,
      now(), id, ctx.workspace.id,
    );
    audit(db, ctx.workspace.id, ctx.user.id, 'agent.update', 'agent', id, {}, request.ip);
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow;
    return { agent: serializeAgent(row) };
  });

  app.delete('/api/w/:workspaceId/agents/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT created_by FROM agents WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as { created_by: string } | undefined;
    if (!existing) throw notFound('智能体不存在');
    if (existing.created_by !== ctx.user.id && ctx.role === 'member') throw conflict('只能删除自己创建的智能体');
    db.prepare('DELETE FROM agents WHERE id = ? AND workspace_id = ?').run(id, ctx.workspace.id);
    audit(db, ctx.workspace.id, ctx.user.id, 'agent.delete', 'agent', id, {}, request.ip);
    return { ok: true };
  });
}
