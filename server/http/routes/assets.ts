import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { json, now, tx } from '../../infrastructure/db.js';
import { audit, requireUser, requireWorkspace, type AuthUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../../domain/errors.js';
import {
  assetInputSchema,
  assetPatchSchema,
  publishSchema,
  validateAssetPayload,
  type AssetKind,
} from '../../domain/schemas.js';
import { decryptSecret, encryptSecret, sha256, slugify } from '../../domain/security.js';
import { assertSafeUrl } from '../../infrastructure/connectors.js';
import { models } from '../../config.js';

type AssetRow = {
  id: string;
  workspace_id: string;
  kind: AssetKind;
  name: string;
  slug: string;
  summary: string;
  description: string;
  icon: string;
  category: string;
  payload_json: string;
  secrets_encrypted: string;
  version: string;
  status: string;
  visibility: string;
  author_id: string;
  source_asset_id: string | null;
  installs: number;
  stars: number;
  featured: number;
  created_at: number;
  updated_at: number;
  author_name?: string;
};

type VersionRow = { id: string; asset_id: string; version: string; snapshot_json: string; content_hash: string };

function redactPayload(kind: AssetKind, payload: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(payload);
  if (kind === 'connector') delete clone.headers;
  if (kind === 'plugin' && Array.isArray(clone.items)) {
    for (const item of clone.items as Array<{ kind: string; payload?: Record<string, unknown> }>) {
      if (item.kind === 'connector' && item.payload) delete item.payload.headers;
    }
  }
  return clone;
}

function secretKeys(row: AssetRow): string[] {
  if (!row.secrets_encrypted) return [];
  try {
    return Object.keys(JSON.parse(decryptSecret(row.secrets_encrypted)));
  } catch {
    return [];
  }
}

function serializeAsset(row: AssetRow) {
  const payload = redactPayload(row.kind, json<Record<string, unknown>>(row.payload_json, {}));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    description: row.description,
    icon: row.icon,
    category: row.category,
    payload,
    secretKeys: secretKeys(row),
    version: row.version,
    status: row.status,
    visibility: row.visibility,
    authorId: row.author_id,
    authorName: row.author_name ?? '',
    sourceAssetId: row.source_asset_id,
    installs: row.installs,
    stars: row.stars,
    featured: Boolean(row.featured),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueSlug(db: DB, workspaceId: string, kind: string, name: string): string {
  const base = slugify(name);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    const exists = db.prepare('SELECT id FROM assets WHERE workspace_id = ? AND kind = ? AND slug = ?').get(workspaceId, kind, candidate);
    if (!exists) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function canEdit(ctx: ReturnType<typeof requireWorkspace>, row: AssetRow): boolean {
  return ctx.user.platformRole === 'admin' || ctx.role !== 'member' || row.author_id === ctx.user.id;
}

function marketVisibility(row: AssetRow): boolean {
  return row.status === 'published' && row.visibility === 'public';
}

async function validatePayload(kind: AssetKind, payload: Record<string, unknown>) {
  const parsed = validateAssetPayload(kind, payload);
  if (kind === 'connector') {
    const url = String(parsed.url ?? '');
    await assertSafeUrl(url);
  }
  if (kind === 'plugin') {
    for (const item of (parsed.items as Array<{ kind: AssetKind; payload: Record<string, unknown> }>) ?? []) {
      if (item.kind === 'connector') await assertSafeUrl(String(item.payload.url ?? ''));
    }
  }
  return parsed;
}

function snapshotOf(row: AssetRow, payload: Record<string, unknown>): string {
  return JSON.stringify({
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    description: row.description,
    icon: row.icon,
    category: row.category,
    version: row.version,
    payload,
  });
}

function createAgentFromExpert(db: DB, workspaceId: string, userId: string, name: string, summary: string, payload: Record<string, unknown>): string {
  const id = randomUUID();
  const timestamp = now();
  const requested = payload.model ? String(payload.model) : '';
  const model = models().some((m) => m.id === requested) ? requested : '';
  db.prepare(
    `INSERT INTO agents (id, workspace_id, name, description, system_prompt, model, icon, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, name, summary, String(payload.systemPrompt ?? ''), model, 'graduation-cap', userId, timestamp, timestamp);
  return id;
}

export async function assetRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/market', async (request) => {
    const { kind = '', q = '', sort = 'featured' } = request.query as { kind?: string; q?: string; sort?: string };
    const user = tryUser(request, db);
    const where = ["a.status = 'published'", "a.visibility = 'public'"];
    const params: Array<string | number> = [];
    if (kind) {
      where.push('a.kind = ?');
      params.push(kind);
    }
    if (q.trim()) {
      where.push('(a.name LIKE ? OR a.summary LIKE ? OR a.description LIKE ?)');
      const like = `%${q.trim()}%`;
      params.push(like, like, like);
    }
    const order = sort === 'new' ? 'a.created_at DESC' : sort === 'stars' ? 'a.stars DESC, a.installs DESC' : 'a.featured DESC, a.installs DESC, a.stars DESC';
    const rows = db
      .prepare(
        `SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id
         WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 80`,
      )
      .all(...params) as AssetRow[];
    const starred = user
      ? new Set(
          (db
            .prepare(`SELECT asset_id FROM asset_stars WHERE user_id = ? AND asset_id IN (${rows.map(() => '?').join(',') || "''"})`)
            .all(user.id, ...rows.map((r) => r.id)) as Array<{ asset_id: string }>).map((r) => r.asset_id),
        )
      : new Set<string>();
    return {
      items: rows.map((row) => ({ ...serializeAsset(row), starred: starred.has(row.id) })),
      kinds: db
        .prepare("SELECT kind, COUNT(*) as count FROM assets WHERE status = 'published' AND visibility = 'public' GROUP BY kind")
        .all(),
    };
  });

  app.get('/api/market/:id', async (request) => {
    const { id } = request.params as { id: string };
    const row = db
      .prepare('SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id WHERE a.id = ?')
      .get(id) as AssetRow | undefined;
    if (!row || !marketVisibility(row)) throw notFound('市场中不存在该条目');
    const versions = db.prepare('SELECT version, created_at FROM asset_versions WHERE asset_id = ? ORDER BY created_at DESC').all(id);
    return { asset: serializeAsset(row), versions };
  });

  app.get('/api/w/:workspaceId/assets', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { kind = '', q = '' } = request.query as { kind?: string; q?: string };
    const where = ['a.workspace_id = ?'];
    const params: Array<string | number> = [ctx.workspace.id];
    if (kind) {
      where.push('a.kind = ?');
      params.push(kind);
    }
    if (q.trim()) {
      where.push('(a.name LIKE ? OR a.summary LIKE ?)');
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }
    const rows = db
      .prepare(`SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC`)
      .all(...params) as AssetRow[];
    return { assets: rows.map(serializeAsset) };
  });

  app.post('/api/w/:workspaceId/assets', async (request) => {
    const ctx = requireWorkspace(request, db);
    const input = assetInputSchema.parse(request.body ?? {});
    const payload = await validatePayload(input.kind, input.payload);
    if (JSON.stringify(payload).length > 32_000) throw badRequest('资产内容超过 32KB 上限');
    const secrets = input.secrets ?? {};
    if (Object.keys(secrets).some((k) => !/^[A-Za-z0-9_-]{1,64}$/.test(k))) throw badRequest('密钥字段名不合法');
    if (input.kind !== 'connector' && Object.keys(secrets).length) throw badRequest('只有连接器支持密钥');
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO assets (id, workspace_id, kind, name, slug, summary, description, icon, category, payload_json,
        secrets_encrypted, version, status, visibility, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'private', ?, ?, ?)`,
    ).run(
      id, ctx.workspace.id, input.kind, input.name, uniqueSlug(db, ctx.workspace.id, input.kind, input.name),
      input.summary, input.description, input.icon, input.category, JSON.stringify(payload),
      Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : '',
      input.version, ctx.user.id, timestamp, timestamp,
    );
    audit(db, ctx.workspace.id, ctx.user.id, `${input.kind}.create`, 'asset', id, { name: input.name }, request.ip);
    const row = db.prepare('SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id WHERE a.id = ?').get(id) as AssetRow;
    return { asset: serializeAsset(row) };
  });

  app.patch('/api/w/:workspaceId/assets/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const existing = db.prepare('SELECT * FROM assets WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as AssetRow | undefined;
    if (!existing) throw notFound('资产不存在');
    if (!canEdit(ctx, existing)) throw forbidden('只能修改自己创建的内容');
    const input = assetPatchSchema.parse(request.body ?? {});
    const payload = input.payload ? await validatePayload(existing.kind, input.payload) : json<Record<string, unknown>>(existing.payload_json, {});
    const secrets = input.secrets
      ? Object.keys(input.secrets).length ? encryptSecret(JSON.stringify(input.secrets)) : ''
      : existing.secrets_encrypted;
    const nextStatus = existing.status === 'published' ? 'draft' : existing.status;
    const nextVisibility = existing.status === 'published' ? 'private' : existing.visibility;
    db.prepare(
      `UPDATE assets SET name = ?, summary = ?, description = ?, icon = ?, category = ?, payload_json = ?,
        secrets_encrypted = ?, version = ?, status = ?, visibility = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    ).run(
      input.name ?? existing.name, input.summary ?? existing.summary, input.description ?? existing.description,
      input.icon ?? existing.icon, input.category ?? existing.category, JSON.stringify(payload), secrets,
      input.version ?? existing.version, nextStatus, nextVisibility, now(), id, ctx.workspace.id,
    );
    audit(db, ctx.workspace.id, ctx.user.id, `${existing.kind}.update`, 'asset', id, {}, request.ip);
    const row = db.prepare('SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id WHERE a.id = ?').get(id) as AssetRow;
    return { asset: serializeAsset(row) };
  });

  app.post('/api/w/:workspaceId/assets/:id/publish', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM assets WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as AssetRow | undefined;
    if (!row) throw notFound('资产不存在');
    if (row.status === 'suspended') throw forbidden('该资产已被平台下架，请联系平台管理员处理');
    if (!canEdit(ctx, row)) throw forbidden('只能发布自己创建的内容');
    if (ctx.role === 'member' && ctx.workspace.settings.allowMemberPublish === false) throw forbidden('管理员已关闭成员发布权限');
    const input = publishSchema.parse(request.body ?? {});
    const payload = await validatePayload(row.kind, json<Record<string, unknown>>(row.payload_json, {}));
    if (JSON.stringify(payload).length > 32_000) throw badRequest('资产内容超过 32KB 上限');
    if (row.summary.trim().length < 8) throw badRequest('发布前请填写至少 8 个字的简介');
    const version = input.version ?? row.version;
    const existingVersion = db.prepare('SELECT id FROM asset_versions WHERE asset_id = ? AND version = ?').get(id, version);
    if (existingVersion) throw conflict('该版本已发布，请提升版本号');
    const snapshot = JSON.stringify({
      kind: row.kind, name: row.name, summary: row.summary, description: row.description,
      icon: row.icon, category: row.category, version, payload,
    });
    tx(db, () => {
      db.prepare(
        `INSERT INTO asset_versions (id, asset_id, version, snapshot_json, content_hash, published_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, version, snapshot, sha256(snapshot), ctx.user.id, now());
      db.prepare("UPDATE assets SET status = 'published', visibility = 'public', version = ?, updated_at = ? WHERE id = ?").run(version, now(), id);
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'asset.publish', 'asset', id, { version, kind: row.kind }, request.ip);
    const updated = db.prepare('SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id WHERE a.id = ?').get(id) as AssetRow;
    return { asset: serializeAsset(updated) };
  });

  app.post('/api/w/:workspaceId/assets/:id/install', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const source = db
      .prepare('SELECT a.*, u.name as author_name FROM assets a JOIN users u ON u.id = a.author_id WHERE a.id = ?')
      .get(id) as AssetRow | undefined;
    if (!source || !marketVisibility(source)) throw notFound('该资产未上架或已下架');
    if (source.workspace_id === ctx.workspace.id) throw conflict('这是你所在工作区的资产');
    const installed = db.prepare('SELECT id FROM asset_installs WHERE workspace_id = ? AND asset_id = ?').get(ctx.workspace.id, id);
    if (installed) throw conflict('该资产已安装');
    const version = db
      .prepare('SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(id) as VersionRow | undefined;
    if (!version) throw conflict('该资产缺少可安装版本');
    const snapshot = json<{ name: string; summary: string; description: string; icon: string; category: string; payload: Record<string, unknown> }>(version.snapshot_json, {
      name: source.name, summary: source.summary, description: source.description, icon: source.icon, category: source.category, payload: {},
    });
    const payload = validateAssetPayload(source.kind, snapshot.payload);
    let installedAssetId = '';
    tx(db, () => {
      installedAssetId = randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO assets (id, workspace_id, kind, name, slug, summary, description, icon, category, payload_json,
          secrets_encrypted, version, status, visibility, author_id, source_asset_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'draft', 'private', ?, ?, ?, ?)`,
      ).run(
        installedAssetId, ctx.workspace.id, source.kind, snapshot.name,
        uniqueSlug(db, ctx.workspace.id, source.kind, snapshot.name), snapshot.summary, snapshot.description,
        snapshot.icon, snapshot.category, JSON.stringify(payload), version.version, ctx.user.id, source.id, timestamp, timestamp,
      );
      db.prepare(
        `INSERT INTO asset_installs (id, workspace_id, asset_id, installed_asset_id, source_version, installed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), ctx.workspace.id, source.id, installedAssetId, version.version, ctx.user.id, timestamp);
      db.prepare('UPDATE assets SET installs = installs + 1 WHERE id = ?').run(source.id);
      if (source.kind === 'plugin') {
        const items = (payload.items as Array<{ kind: AssetKind; name: string; summary: string; payload: Record<string, unknown> }>) ?? [];
        for (const item of items) {
          const childId = randomUUID();
          db.prepare(
            `INSERT INTO assets (id, workspace_id, kind, name, slug, summary, description, icon, category, payload_json,
              secrets_encrypted, version, status, visibility, author_id, source_asset_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, '', 'box', '插件内容', ?, '', ?, 'draft', 'private', ?, ?, ?, ?)`,
          ).run(
            childId, ctx.workspace.id, item.kind, item.name, uniqueSlug(db, ctx.workspace.id, item.kind, item.name),
            item.summary, JSON.stringify(validateAssetPayload(item.kind, item.payload)), version.version,
            ctx.user.id, source.id, timestamp, timestamp,
          );
        }
      }
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'asset.install', 'asset', source.id, { installedAssetId, version: version.version }, request.ip);
    return { installedAssetId, kind: source.kind };
  });

  app.post('/api/w/:workspaceId/assets/:id/hire', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const row = db.prepare("SELECT * FROM assets WHERE id = ? AND workspace_id = ? AND kind = 'expert'").get(id, ctx.workspace.id) as AssetRow | undefined;
    if (!row) throw notFound('专家不存在');
    const payload = json<Record<string, unknown>>(row.payload_json, {});
    const agentId = createAgentFromExpert(db, ctx.workspace.id, ctx.user.id, row.name, row.summary, payload);
    audit(db, ctx.workspace.id, ctx.user.id, 'expert.hire', 'agent', agentId, { assetId: id }, request.ip);
    return { agentId };
  });

  app.post('/api/w/:workspaceId/assets/:id/star', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
    if (!row || (!marketVisibility(row) && row.workspace_id !== ctx.workspace.id)) throw notFound('资产不存在');
    const existing = db.prepare('SELECT 1 FROM asset_stars WHERE user_id = ? AND asset_id = ?').get(ctx.user.id, id);
    tx(db, () => {
      if (existing) {
        db.prepare('DELETE FROM asset_stars WHERE user_id = ? AND asset_id = ?').run(ctx.user.id, id);
        db.prepare('UPDATE assets SET stars = MAX(0, stars - 1) WHERE id = ?').run(id);
      } else {
        db.prepare('INSERT INTO asset_stars (user_id, asset_id, created_at) VALUES (?, ?, ?)').run(ctx.user.id, id, now());
        db.prepare('UPDATE assets SET stars = stars + 1 WHERE id = ?').run(id);
      }
    });
    const updated = db.prepare('SELECT stars FROM assets WHERE id = ?').get(id) as { stars: number };
    return { starred: !existing, stars: updated.stars };
  });

  app.delete('/api/w/:workspaceId/assets/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM assets WHERE id = ? AND workspace_id = ?').get(id, ctx.workspace.id) as AssetRow | undefined;
    if (!row) throw notFound('资产不存在');
    if (!canEdit(ctx, row)) throw forbidden('只能删除自己创建的内容');
    if (row.installs > 0) throw conflict('已有用户安装该资产，请先下架而不是删除');
    tx(db, () => {
      const install = db.prepare('SELECT id, asset_id FROM asset_installs WHERE workspace_id = ? AND installed_asset_id = ?').get(ctx.workspace.id, id) as { id: string; asset_id: string } | undefined;
      if (install) {
        db.prepare('DELETE FROM asset_installs WHERE id = ?').run(install.id);
        db.prepare('UPDATE assets SET installs = MAX(0, installs - 1) WHERE id = ?').run(install.asset_id);
      }
      if (row.kind === 'plugin' && row.source_asset_id) {
        db.prepare('DELETE FROM assets WHERE workspace_id = ? AND source_asset_id = ? AND kind != \'plugin\'').run(ctx.workspace.id, row.source_asset_id);
      }
      db.prepare('DELETE FROM assets WHERE id = ? AND workspace_id = ?').run(id, ctx.workspace.id);
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'asset.delete', 'asset', id, {}, request.ip);
    return { ok: true };
  });
}

function tryUser(request: Parameters<typeof requireUser>[0], db: DB): AuthUser | null {
  try {
    return requireUser(request, db);
  } catch {
    return null;
  }
}
