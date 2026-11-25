import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { now } from '../../infrastructure/db.js';
import { config, loginSchema, signupSchema } from '../../config.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../domain/security.js';
import { conflict, forbidden, unauthorized } from '../../domain/errors.js';
import { audit, cookieOptions, publicUser, requireUser, SESSION_COOKIE } from '../context.js';
import { checkRate, checkRateKey, clearRateKey } from '../rate-limit.js';

type UserRow = { id: string; email: string; name: string; avatar: string; platform_role: 'user' | 'admin' };

function createSession(db: DB, userId: string, request: FastifyRequest, reply: FastifyReply) {
  const token = randomToken(32);
  const expiresAt = now() + config.sessionDays * 86_400_000;
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, sha256(token), expiresAt, now(), request.ip, String(request.headers['user-agent'] ?? '').slice(0, 250));
  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
}

function workspaceSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'workspace';
  return `${base}-${randomToken(3).toLowerCase().slice(0, 6)}`;
}

function seedWorkspace(db: DB, userId: string, name: string) {
  const wsId = randomUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO workspaces (id, name, slug, owner_id, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(wsId, name, workspaceSlug(name), userId, JSON.stringify({ defaultModel: '' }), timestamp, timestamp);
  db.prepare('INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(
    wsId, userId, 'owner', timestamp,
  );
  db.prepare(
    `INSERT INTO agents (id, workspace_id, name, description, system_prompt, model, icon, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), wsId, '通用助理', '理解目标、拆解任务并交付结果', '你是一位严谨、主动的执行型助理。先澄清目标，再给出可执行的方案；需要计算或验证时主动使用工具。', '', 'sparkles', userId, timestamp, timestamp,
  );
  return wsId;
}

export async function authRoutes(app: FastifyInstance, db: DB) {
  app.post('/api/auth/signup', async (request, reply) => {
    if (!config.registrationOpen) throw forbidden('当前关闭了注册，请联系管理员');
    checkRate(request, 'signup', 5, 10 * 60_000);
    const input = signupSchema.parse(request.body ?? {});
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email);
    if (exists) throw conflict('该邮箱已注册');
    const userId = randomUUID();
    const timestamp = now();
    const passwordHash = await hashPassword(input.password);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, platform_role, avatar, created_at, last_login_at)
         VALUES (?, ?, ?, ?, 'user', ?, ?, ?)`,
      ).run(userId, input.email, input.name, passwordHash, '', timestamp, timestamp);
      const workspaceName = input.workspaceName?.trim() || `${input.name} 的工作区`;
      seedWorkspace(db, userId, workspaceName);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    createSession(db, userId, request, reply);
    return { ok: true };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body ?? {});
    checkRate(request, 'login-ip', 30, 10 * 60_000);
    checkRateKey(`login-account:${input.email}`, 8, 10 * 60_000);
    const row = db
      .prepare('SELECT id, email, name, password_hash, avatar, platform_role FROM users WHERE email = ?')
      .get(input.email) as (UserRow & { password_hash: string }) | undefined;
    const valid = row ? await verifyPassword(input.password, row.password_hash) : false;
    if (!row || !valid) throw unauthorized('邮箱或密码不正确');
    clearRateKey(`login-account:${input.email}`);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), row.id);
    createSession(db, row.id, request, reply);
    return { user: publicUser(row) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const user = requireUser(request, db);
    const workspaces = db
      .prepare(
        `SELECT w.id, w.name, w.slug, m.role, w.plan, w.settings_json, w.created_at
         FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
         WHERE m.user_id = ? ORDER BY w.updated_at DESC`,
      )
      .all(user.id) as Array<Record<string, unknown> & { settings_json: string; id: string }>;
    return {
      user,
      workspaces: workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        role: ws.role,
        plan: ws.plan,
        settings: JSON.parse(ws.settings_json),
      })),
    };
  });

  app.post('/api/auth/password', async (request, reply) => {
    const user = requireUser(request, db);
    const body = (request.body ?? {}) as { current?: string; next?: string };
    if (!body.current || !body.next || body.next.length < 12) throw conflict('新密码至少 12 位');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!(await verifyPassword(body.current, row.password_hash))) throw unauthorized('当前密码不正确');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.next), user.id);
    const token = request.cookies?.[SESSION_COOKIE];
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(token ?? ''));
    return { ok: true };
  });

  app.get('/api/invites/:token', async (request) => {
    const token = (request.params as { token: string }).token;
    const row = db
      .prepare(
        `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, w.name as workspace_name, u.name as inviter_name
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = ?`,
      )
      .get(sha256(token)) as Record<string, unknown> | undefined;
    if (!row) throw unauthorized('邀请链接无效');
    if (row.accepted_at) throw conflict('邀请已被使用');
    if ((row.expires_at as number) < now()) throw conflict('邀请已过期');
    return { workspaceName: row.workspace_name, email: row.email, role: row.role, inviterName: row.inviter_name };
  });

  app.post('/api/invites/:token/accept', async (request) => {
    const user = requireUser(request, db);
    const token = (request.params as { token: string }).token;
    const row = db
      .prepare('SELECT id, workspace_id, email, role, expires_at, accepted_at FROM invites WHERE token_hash = ?')
      .get(sha256(token)) as { id: string; workspace_id: string; email: string; role: string; expires_at: number; accepted_at: number | null } | undefined;
    if (!row || row.accepted_at || row.expires_at < now()) throw conflict('邀请无效或已过期');
    if (row.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('请使用受邀邮箱登录后接受邀请');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR REPLACE INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(
        row.workspace_id, user.id, row.role, now(),
      );
      db.prepare('UPDATE invites SET accepted_at = ? WHERE id = ?').run(now(), row.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    audit(db, row.workspace_id, user.id, 'member.accept', 'member', user.id, {}, request.ip);
    return { workspaceId: row.workspace_id };
  });
}
