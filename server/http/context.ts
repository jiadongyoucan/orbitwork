import type { FastifyRequest } from 'fastify';
import type { DB } from '../infrastructure/db.js';
import { json, now } from '../infrastructure/db.js';
import { assertRole, forbidden, notFound, unauthorized, type PlatformRole, type WorkspaceRole } from '../domain/errors.js';
import { sha256 } from '../domain/security.js';
import { config } from '../config.js';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatar: string;
  platformRole: PlatformRole;
};

export type WorkspaceContext = {
  user: AuthUser;
  workspace: { id: string; name: string; slug: string; ownerId: string; plan: string; settings: Record<string, unknown> };
  role: WorkspaceRole;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar: string;
  platform_role: PlatformRole;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: string;
  settings_json: string;
};

export const SESSION_COOKIE = 'orbit_session';

export function sessionToken(request: FastifyRequest): string | null {
  return request.cookies?.[SESSION_COOKIE] ?? null;
}

export function requireUser(request: FastifyRequest, db: DB): AuthUser {
  const token = sessionToken(request);
  if (!token) throw unauthorized();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.avatar, u.platform_role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as (UserRow & { expires_at: number }) | undefined;
  if (!row) throw unauthorized();
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    throw unauthorized('登录已过期，请重新登录');
  }
  return { id: row.id, email: row.email, name: row.name, avatar: row.avatar, platformRole: row.platform_role };
}

export function requirePlatformAdmin(request: FastifyRequest, db: DB): AuthUser {
  const user = requireUser(request, db);
  if (user.platformRole !== 'admin') throw forbidden('需要平台管理员权限');
  return user;
}

export function requireWorkspace(
  request: FastifyRequest,
  db: DB,
  minimum: WorkspaceRole = 'member',
): WorkspaceContext {
  const user = requireUser(request, db);
  const workspaceId = (request.params as { workspaceId?: string }).workspaceId;
  if (!workspaceId) throw notFound('工作区不存在');
  const row = db
    .prepare(
      `SELECT w.id, w.name, w.slug, w.owner_id, w.plan, w.settings_json, m.role
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE w.id = ? AND m.user_id = ?`,
    )
    .get(workspaceId, user.id) as (WorkspaceRow & { role: WorkspaceRole }) | undefined;
  if (!row) throw notFound('工作区不存在或你无权访问');
  assertRole(row.role, minimum);
  return {
    user,
    workspace: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      plan: row.plan,
      settings: json<Record<string, unknown>>(row.settings_json, {}),
    },
    role: row.role,
  };
}

export function audit(
  db: DB,
  workspaceId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId = '',
  metadata: Record<string, unknown> = {},
  ip = '',
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, workspace_id, actor_id, action, target_type, target_id, metadata_json, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), workspaceId, actorId, action, targetType, targetId, JSON.stringify(metadata), ip, now());
}

export function platformAudit(
  db: DB,
  actorId: string,
  action: string,
  targetType: string,
  targetId = '',
  metadata: Record<string, unknown> = {},
  ip = '',
): void {
  db.prepare(
    `INSERT INTO platform_audit_logs (id, actor_id, action, target_type, target_id, metadata_json, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), actorId, action, targetType, targetId, JSON.stringify(metadata), ip, now());
}

export function publicUser(row: UserRow) {
  return { id: row.id, email: row.email, name: row.name, avatar: row.avatar, platformRole: row.platform_role };
}

export function cookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 24 * 60 * 60,
  };
}
