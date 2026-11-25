import type { FastifyInstance } from 'fastify';
import type { DB } from '../../infrastructure/db.js';
import { now } from '../../infrastructure/db.js';
import { platformAudit, requirePlatformAdmin } from '../context.js';
import { badRequest, conflict, notFound } from '../../domain/errors.js';
import { hashPassword } from '../../domain/security.js';
import { audit } from '../context.js';

export async function adminRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/admin/stats', async (request) => {
    requirePlatformAdmin(request, db);
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
    const tokens = db.prepare('SELECT COALESCE(SUM(input_tokens),0) as i, COALESCE(SUM(output_tokens),0) as o FROM messages').get() as { i: number; o: number };
    return {
      users: count('users'),
      workspaces: count('workspaces'),
      chats: count('chats'),
      messages: count('messages'),
      assets: count('assets'),
      published: (db.prepare("SELECT COUNT(*) as n FROM assets WHERE status = 'published'").get() as { n: number }).n,
      tokens,
      signups: db.prepare('SELECT date(created_at / 1000, \'unixepoch\') as day, COUNT(*) as n FROM users GROUP BY day ORDER BY day DESC LIMIT 14').all(),
    };
  });

  app.get('/api/admin/users', async (request) => {
    requirePlatformAdmin(request, db);
    const { q = '' } = request.query as { q?: string };
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.platform_role, u.created_at, u.last_login_at,
          (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) as workspace_count,
          (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) as chat_count
         FROM users u WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.created_at DESC LIMIT 100`,
      )
      .all(`%${q}%`, `%${q}%`);
    return { users: rows };
  });

  app.patch('/api/admin/users/:id/role', async (request) => {
    const admin = requirePlatformAdmin(request, db);
    const { id } = request.params as { id: string };
    const body = request.body as { role?: string };
    if (!['user', 'admin'].includes(body.role ?? '')) throw badRequest('角色不合法');
    if (id === admin.id) throw conflict('不能修改自己的平台角色');
    const target = db.prepare('SELECT id, platform_role FROM users WHERE id = ?').get(id) as { id: string; platform_role: string } | undefined;
    if (!target) throw notFound('用户不存在');
    if (target.platform_role === 'admin' && body.role === 'user') {
      const admins = (db.prepare("SELECT COUNT(*) as n FROM users WHERE platform_role = 'admin'").get() as { n: number }).n;
      if (admins <= 1) throw conflict('至少保留一名平台管理员');
    }
    db.prepare('UPDATE users SET platform_role = ? WHERE id = ?').run(body.role as string, id);
    platformAudit(db, admin.id, 'admin.user.role', 'user', id, { role: body.role }, request.ip);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/password', async (request) => {
    const admin = requirePlatformAdmin(request, db);
    const { id } = request.params as { id: string };
    const body = request.body as { password?: string };
    if (!body.password || body.password.length < 12) throw badRequest('密码至少 12 位');
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!target) throw notFound('用户不存在');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    platformAudit(db, admin.id, 'admin.user.password_reset', 'user', id, {}, request.ip);
    return { ok: true };
  });

  app.get('/api/admin/assets', async (request) => {
    requirePlatformAdmin(request, db);
    const rows = db
      .prepare(
        `SELECT a.id, a.workspace_id, a.kind, a.name, a.summary, a.status, a.visibility, a.installs, a.stars,
                a.version, a.created_at, u.name as author_name, w.name as workspace_name
         FROM assets a JOIN users u ON u.id = a.author_id JOIN workspaces w ON w.id = a.workspace_id
         WHERE a.status != 'draft' ORDER BY a.updated_at DESC LIMIT 150`,
      )
      .all();
    return { assets: rows };
  });

  app.post('/api/admin/assets/:id/moderate', async (request) => {
    const admin = requirePlatformAdmin(request, db);
    const { id } = request.params as { id: string };
    const body = request.body as { action?: string };
    if (!['suspend', 'restore', 'feature', 'unfeature'].includes(body.action ?? '')) throw badRequest('操作不合法');
    const asset = db.prepare('SELECT id, workspace_id, status, name FROM assets WHERE id = ?').get(id) as
      | { id: string; workspace_id: string; status: string; name: string }
      | undefined;
    if (!asset) throw notFound('资产不存在');
    if (body.action === 'suspend') db.prepare("UPDATE assets SET status = 'suspended', updated_at = ? WHERE id = ?").run(now(), id);
    if (body.action === 'restore') db.prepare("UPDATE assets SET status = 'published', updated_at = ? WHERE id = ?").run(now(), id);
    if (body.action === 'feature') db.prepare('UPDATE assets SET featured = 1, updated_at = ? WHERE id = ?').run(now(), id);
    if (body.action === 'unfeature') db.prepare('UPDATE assets SET featured = 0, updated_at = ? WHERE id = ?').run(now(), id);
    audit(db, asset.workspace_id, admin.id, `admin.asset.${body.action}`, 'asset', id, { name: asset.name }, request.ip);
    platformAudit(db, admin.id, `admin.asset.${body.action}`, 'asset', id, { name: asset.name }, request.ip);
    return { ok: true };
  });

  app.get('/api/admin/audit', async (request) => {
    requirePlatformAdmin(request, db);
    const rows = db
      .prepare(
        `SELECT a.id, a.workspace_id, a.action, a.target_type, a.target_id, a.created_at, u.name as actor_name, w.name as workspace_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN workspaces w ON w.id = a.workspace_id
         ORDER BY a.created_at DESC LIMIT 150`,
      )
      .all() as Array<Record<string, unknown>>;
    const platformRows = db
      .prepare(
        `SELECT p.id, '' as workspace_id, p.action, p.target_type, p.target_id, p.created_at, u.name as actor_name, '平台' as workspace_name
         FROM platform_audit_logs p LEFT JOIN users u ON u.id = p.actor_id ORDER BY p.created_at DESC LIMIT 150`,
      )
      .all() as Array<Record<string, unknown>>;
    const logs = [...rows, ...platformRows].sort((a, b) => Number(b.created_at) - Number(a.created_at)).slice(0, 150);
    return { logs };
  });
}
