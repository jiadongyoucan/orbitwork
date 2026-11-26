import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { now, tx } from '../../infrastructure/db.js';
import { audit, requireUser, requireWorkspace } from '../context.js';
import { assertRole, conflict, forbidden, notFound } from '../../domain/errors.js';
import { hashPassword, randomToken, sha256 } from '../../domain/security.js';
import { removeWorkspaceFiles } from '../../infrastructure/files.js';
import { inviteInputSchema, memberRoleSchema, settingsSchema, workspaceInputSchema } from '../../domain/schemas.js';
import { defaultModel, models } from '../../config.js';

type Role = 'owner' | 'admin' | 'member';

function slug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'space';
  return `${base}-${randomToken(3).toLowerCase().slice(0, 6)}`;
}

export async function workspaceRoutes(app: FastifyInstance, db: DB) {
  app.post('/api/workspaces', async (request) => {
    const user = requireUser(request, db);
    const input = workspaceInputSchema.parse(request.body ?? {});
    const id = randomUUID();
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO workspaces (id, name, slug, owner_id, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.name, slug(input.name), user.id, JSON.stringify({ defaultModel: defaultModel() }), timestamp, timestamp);
      db.prepare('INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, 'owner', timestamp);
      db.prepare(
        `INSERT INTO agents (id, workspace_id, name, description, system_prompt, model, icon, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, '通用助理', '理解目标、拆解任务并交付结果', '你是一位严谨、主动的执行型助理。先澄清目标，再给出可执行的方案；需要计算或验证时主动使用工具。', defaultModel(), 'sparkles', user.id, timestamp, timestamp);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    audit(db, id, user.id, 'workspace.create', 'workspace', id, {}, request.ip);
    return { workspace: { id, name: input.name, icon: input.icon, role: 'owner' } };
  });

  app.get('/api/w/:workspaceId/overview', async (request) => {
    const ctx = requireWorkspace(request, db);
    const ws = ctx.workspace.id;
    const one = (sql: string) => (db.prepare(sql).get(ws) as { n: number }).n;
    const recentChats = db
      .prepare(
        `SELECT c.id, c.title, c.model, c.updated_at, c.agent_id, a.name as agent_name
         FROM chats c LEFT JOIN agents a ON a.id = c.agent_id
         WHERE c.workspace_id = ? AND c.user_id = ? AND c.archived = 0 ORDER BY c.updated_at DESC LIMIT 8`,
      )
      .all(ws, ctx.user.id);
    const usage = db
      .prepare('SELECT COALESCE(SUM(m.input_tokens),0) as tokens_in, COALESCE(SUM(m.output_tokens),0) as tokens_out FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.workspace_id = ? AND c.user_id = ?')
      .get(ws, ctx.user.id) as { tokens_in: number; tokens_out: number };
    return {
      workspace: { ...ctx.workspace, role: ctx.role },
      stats: {
        chats: (db.prepare('SELECT COUNT(*) as n FROM chats WHERE workspace_id = ? AND user_id = ?').get(ws, ctx.user.id) as { n: number }).n,
        agents: one('SELECT COUNT(*) as n FROM agents WHERE workspace_id = ?'),
        memories: one('SELECT COUNT(*) as n FROM memories WHERE workspace_id = ?'),
        assets: one('SELECT COUNT(*) as n FROM assets WHERE workspace_id = ?'),
        members: one('SELECT COUNT(*) as n FROM memberships WHERE workspace_id = ?'),
      },
      usage,
      recentChats,
      models: models(),
    };
  });

  app.get('/api/w/:workspaceId/settings', async (request) => {
    const ctx = requireWorkspace(request, db);
    return { settings: { ...ctx.workspace.settings, defaultModel: ctx.workspace.settings.defaultModel || defaultModel() }, role: ctx.role };
  });

  app.patch('/api/w/:workspaceId/settings', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const input = settingsSchema.parse(request.body ?? {});
    if (input.defaultModel && !models().some((m) => m.id === input.defaultModel)) throw conflict('模型不在允许列表内');
    const settings = { ...ctx.workspace.settings, ...input };
    db.prepare('UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(settings), now(), ctx.workspace.id);
    audit(db, ctx.workspace.id, ctx.user.id, 'workspace.settings.update', 'workspace', ctx.workspace.id, input, request.ip);
    return { settings };
  });

  app.patch('/api/w/:workspaceId', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const input = workspaceInputSchema.partial().parse(request.body ?? {});
    if (input.name) db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?').run(input.name, now(), ctx.workspace.id);
    audit(db, ctx.workspace.id, ctx.user.id, 'workspace.update', 'workspace', ctx.workspace.id, input, request.ip);
    return { ok: true };
  });

  app.delete('/api/w/:workspaceId', async (request) => {
    const ctx = requireWorkspace(request, db, 'owner');
    tx(db, () => {
      const installs = db.prepare('SELECT asset_id, COUNT(*) as n FROM asset_installs WHERE workspace_id = ? GROUP BY asset_id').all(ctx.workspace.id) as Array<{ asset_id: string; n: number }>;
      for (const install of installs) {
        db.prepare('UPDATE assets SET installs = MAX(0, installs - ?) WHERE id = ?').run(install.n, install.asset_id);
      }
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(ctx.workspace.id);
    });
    removeWorkspaceFiles(ctx.workspace.id);
    return { ok: true };
  });

  app.get('/api/w/:workspaceId/members', async (request) => {
    const ctx = requireWorkspace(request, db);
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.avatar, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
         ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.name`,
      )
      .all(ctx.workspace.id);
    const invites = db
      .prepare('SELECT id, email, role, expires_at, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC')
      .all(ctx.workspace.id);
    return { members, invites, myRole: ctx.role };
  });

  app.post('/api/w/:workspaceId/invites', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const input = inviteInputSchema.parse(request.body ?? {});
    const target = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email) as { id: string } | undefined;
    if (target) {
      const member = db.prepare('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?').get(ctx.workspace.id, target.id);
      if (member) throw conflict('该用户已是成员');
    }
    const token = randomToken(32);
    db.prepare(
      `INSERT INTO invites (id, workspace_id, email, role, token_hash, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), ctx.workspace.id, input.email, input.role, sha256(token), now() + 72 * 3_600_000, ctx.user.id, now());
    audit(db, ctx.workspace.id, ctx.user.id, 'member.invite', 'invite', input.email, { role: input.role }, request.ip);
    return { inviteUrl: `/invite/${token}`, expiresInHours: 72 };
  });

  app.patch('/api/w/:workspaceId/members/:memberId', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { memberId } = request.params as { memberId: string };
    const input = memberRoleSchema.parse(request.body ?? {});
    const target = db
      .prepare('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?')
      .get(ctx.workspace.id, memberId) as { role: Role } | undefined;
    if (!target) throw notFound('成员不存在');
    if (target.role === 'owner') throw forbidden('不能修改所有者角色');
    if (ctx.role === 'admin' && input.role === 'admin') throw forbidden('管理员不能提升其他管理员');
    db.prepare('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?').run(input.role, ctx.workspace.id, memberId);
    audit(db, ctx.workspace.id, ctx.user.id, 'member.role', 'member', memberId, { role: input.role }, request.ip);
    return { ok: true };
  });

  app.delete('/api/w/:workspaceId/members/:memberId', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { memberId } = request.params as { memberId: string };
    const target = db
      .prepare('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?')
      .get(ctx.workspace.id, memberId) as { role: Role } | undefined;
    if (!target) throw notFound('成员不存在');
    if (target.role === 'owner') throw forbidden('不能移除工作区所有者');
    if (memberId === ctx.user.id) throw forbidden('不能移除自己，请使用退出工作区');
    db.prepare('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?').run(ctx.workspace.id, memberId);
    audit(db, ctx.workspace.id, ctx.user.id, 'member.remove', 'member', memberId, {}, request.ip);
    return { ok: true };
  });

  app.post('/api/w/:workspaceId/leave', async (request) => {
    const ctx = requireWorkspace(request, db);
    if (ctx.role === 'owner') throw forbidden('所有者不能退出，请先转让或删除工作区');
    db.prepare('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?').run(ctx.workspace.id, ctx.user.id);
    return { ok: true };
  });

  app.get('/api/w/:workspaceId/audit', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata_json, a.created_at, u.name as actor_name, u.email as actor_email
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 100`,
      )
      .all(ctx.workspace.id);
    return { logs: rows };
  });
}
