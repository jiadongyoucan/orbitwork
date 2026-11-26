import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../../infrastructure/db.js';
import { json, now, tx } from '../../infrastructure/db.js';
import { config } from '../../config.js';
import { audit, requireWorkspace } from '../context.js';
import { badRequest, conflict, notFound } from '../../domain/errors.js';
import { decryptSecretWithAad, encryptSecretWithAad } from '../../domain/security.js';
import { assertSafeUrl } from '../../infrastructure/connectors.js';
import { modelInputSchema, modelPatchSchema, providerInputSchema, providerPatchSchema } from '../../domain/schemas.js';
import { checkRateKey } from '../rate-limit.js';
import { listEffectiveModels } from '../../application/model-registry.js';

type ProviderRow = {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  base_url: string;
  api_key_encrypted: string;
  enabled: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

type ModelRow = {
  id: string;
  workspace_id: string;
  provider_id: string;
  model_id: string;
  label: string;
  context_window: number;
  enabled: number;
  is_default: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  provider_name?: string;
};

function serializeProvider(row: ProviderRow, modelCount = 0) {
  let keyError = false;
  if (row.api_key_encrypted) {
    try { decryptSecretWithAad(row.api_key_encrypted, `${row.workspace_id}:${row.id}`); } catch { keyError = true; }
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    hasKey: Boolean(row.api_key_encrypted),
    keyError,
    modelCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeModel(row: ModelRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name ?? '',
    modelId: row.model_id,
    label: row.label,
    contextWindow: row.context_window,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function setDefaultSetting(db: DB, workspaceId: string, modelId: string): void {
  const row = db.prepare('SELECT settings_json FROM workspaces WHERE id = ?').get(workspaceId) as { settings_json: string } | undefined;
  if (!row) return;
  const settings = json<Record<string, unknown>>(row.settings_json, {});
  settings.defaultModel = modelId;
  db.prepare('UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(settings), now(), workspaceId);
}

function applyDefault(db: DB, workspaceId: string): string {
  const next = db
    .prepare(
      `SELECT m.model_id FROM workspace_models m JOIN providers p ON p.id = m.provider_id
       WHERE m.workspace_id = ? AND m.enabled = 1 AND p.enabled = 1
       ORDER BY m.is_default DESC, m.created_at ASC LIMIT 1`,
    )
    .get(workspaceId) as { model_id: string } | undefined;
  db.prepare('UPDATE workspace_models SET is_default = 0 WHERE workspace_id = ?').run(workspaceId);
  if (next) db.prepare('UPDATE workspace_models SET is_default = 1 WHERE workspace_id = ? AND model_id = ?').run(workspaceId, next.model_id);
  const effective = listEffectiveModels(db, workspaceId);
  const modelId = next?.model_id ?? effective[0]?.id ?? '';
  setDefaultSetting(db, workspaceId, modelId);
  return modelId;
}

function enabledModelCount(db: DB, workspaceId: string, providerId?: string): number {
  const sql = providerId
    ? 'SELECT COUNT(*) as n FROM workspace_models m JOIN providers p ON p.id = m.provider_id WHERE m.workspace_id = ? AND m.provider_id = ? AND m.enabled = 1 AND p.enabled = 1'
    : 'SELECT COUNT(*) as n FROM workspace_models m JOIN providers p ON p.id = m.provider_id WHERE m.workspace_id = ? AND m.enabled = 1 AND p.enabled = 1';
  return providerId
    ? (db.prepare(sql).get(workspaceId, providerId) as { n: number }).n
    : (db.prepare(sql).get(workspaceId) as { n: number }).n;
}

function totalModels(db: DB, workspaceId: string): number {
  return (db.prepare('SELECT COUNT(*) as n FROM workspace_models WHERE workspace_id = ?').get(workspaceId) as { n: number }).n;
}

function providerFor(db: DB, workspaceId: string, id: string): ProviderRow {
  const row = db.prepare('SELECT * FROM providers WHERE id = ? AND workspace_id = ?').get(id, workspaceId) as ProviderRow | undefined;
  if (!row) throw notFound('Provider 不存在');
  return row;
}

function modelFor(db: DB, workspaceId: string, id: string): ModelRow {
  const row = db
    .prepare('SELECT m.*, p.name as provider_name FROM workspace_models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ? AND m.workspace_id = ?')
    .get(id, workspaceId) as ModelRow | undefined;
  if (!row) throw notFound('模型不存在');
  return row;
}

async function safeBaseUrl(raw: string): Promise<string> {
  const url = await assertSafeUrl(raw, { allowPrivate: config.allowPrivateProviders });
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

export async function modelRoutes(app: FastifyInstance, db: DB) {
  // Effective, non-secret model list for every workspace member.
  app.get('/api/w/:workspaceId/models', async (request) => {
    const ctx = requireWorkspace(request, db);
    const models = listEffectiveModels(db, ctx.workspace.id);
    return { models, demo: models.every((model) => model.demo) && models.length > 0 };
  });

  // Admin configuration surface: providers, models, env fallback and default.
  app.get('/api/w/:workspaceId/model-settings', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const providers = db.prepare('SELECT * FROM providers WHERE workspace_id = ? ORDER BY created_at ASC').all(ctx.workspace.id) as ProviderRow[];
    const models = db
      .prepare('SELECT m.*, p.name as provider_name FROM workspace_models m JOIN providers p ON p.id = m.provider_id WHERE m.workspace_id = ? ORDER BY p.created_at, m.created_at')
      .all(ctx.workspace.id) as ModelRow[];
    const counts = new Map<string, number>();
    for (const model of models) counts.set(model.provider_id, (counts.get(model.provider_id) ?? 0) + 1);
    const effective = listEffectiveModels(db, ctx.workspace.id);
    return {
      providers: providers.map((provider) => serializeProvider(provider, counts.get(provider.id) ?? 0)),
      models: models.map(serializeModel),
      effectiveModels: effective,
      configured: models.length > 0,
      defaultModel: String(ctx.workspace.settings.defaultModel || effective.find((model) => model.isDefault)?.id || effective[0]?.id || ''),
      env: {
        hasKey: Boolean(config.llm.apiKey),
        baseUrl: config.llm.baseUrl,
        modelCount: config.llm.modelsRaw.split(',').filter(Boolean).length,
      },
    };
  });

  app.post('/api/w/:workspaceId/providers', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const input = providerInputSchema.parse(request.body ?? {});
    const baseUrl = await safeBaseUrl(input.baseUrl);
    const duplicate = db.prepare('SELECT id FROM providers WHERE workspace_id = ? AND name = ?').get(ctx.workspace.id, input.name);
    if (duplicate) throw conflict('同名 Provider 已存在');
    const id = randomUUID();
    const timestamp = now();
    const aad = `${ctx.workspace.id}:${id}`;
    db.prepare(
      `INSERT INTO providers (id, workspace_id, name, type, base_url, api_key_encrypted, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'openai-compatible', ?, ?, ?, ?, ?, ?)`,
    ).run(id, ctx.workspace.id, input.name, baseUrl, input.apiKey ? encryptSecretWithAad(input.apiKey, aad) : '', input.enabled ? 1 : 0, ctx.user.id, timestamp, timestamp);
    audit(db, ctx.workspace.id, ctx.user.id, 'provider.create', 'provider', id, { name: input.name, baseUrl }, request.ip);
    return { provider: serializeProvider(providerFor(db, ctx.workspace.id, id)) };
  });

  app.patch('/api/w/:workspaceId/providers/:id', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { id } = request.params as { id: string };
    const existing = providerFor(db, ctx.workspace.id, id);
    const input = providerPatchSchema.parse(request.body ?? {});
    if (input.name && input.name !== existing.name) {
      const duplicate = db.prepare('SELECT id FROM providers WHERE workspace_id = ? AND name = ? AND id != ?').get(ctx.workspace.id, input.name, id);
      if (duplicate) throw conflict('同名 Provider 已存在');
    }
    if (input.enabled === false && existing.enabled) {
      const selected = enabledModelCount(db, ctx.workspace.id, id);
      if (selected > 0 && enabledModelCount(db, ctx.workspace.id) <= selected) {
        throw conflict('停用后将没有可用模型；请先启用其他 Provider 的模型，或删除全部模型以回退平台默认');
      }
    }
    const baseUrl = input.baseUrl ? await safeBaseUrl(input.baseUrl) : existing.base_url;
    let apiKey = existing.api_key_encrypted;
    if (input.clearKey) apiKey = '';
    else if (input.apiKey) apiKey = encryptSecretWithAad(input.apiKey, `${ctx.workspace.id}:${id}`);
    db.prepare('UPDATE providers SET name = ?, base_url = ?, api_key_encrypted = ?, enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(
      input.name ?? existing.name, baseUrl, apiKey, input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0, now(), id, ctx.workspace.id,
    );
    if (input.enabled !== undefined) applyDefault(db, ctx.workspace.id);
    audit(db, ctx.workspace.id, ctx.user.id, 'provider.update', 'provider', id, { name: input.name ?? existing.name }, request.ip);
    return { provider: serializeProvider(providerFor(db, ctx.workspace.id, id)) };
  });

  app.delete('/api/w/:workspaceId/providers/:id', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { id } = request.params as { id: string };
    const existing = providerFor(db, ctx.workspace.id, id);
    tx(db, () => {
      db.prepare('DELETE FROM providers WHERE id = ? AND workspace_id = ?').run(id, ctx.workspace.id);
      applyDefault(db, ctx.workspace.id);
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'provider.delete', 'provider', id, { name: existing.name }, request.ip);
    return { ok: true };
  });

  app.post('/api/w/:workspaceId/providers/:id/test', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    checkRateKey(`provider-test:${ctx.user.id}`, 8, 60_000);
    const { id } = request.params as { id: string };
    const provider = providerFor(db, ctx.workspace.id, id);
    const safeTestUrl = await assertSafeUrl(provider.base_url, { allowPrivate: config.allowPrivateProviders });
    const record = <T extends { ok: boolean; status: number }>(result: T): T => {
      audit(db, ctx.workspace.id, ctx.user.id, 'provider.test', 'provider', id, { ok: result.ok, status: result.status }, request.ip);
      return result;
    };
    let key = '';
    try { key = provider.api_key_encrypted ? decryptSecretWithAad(provider.api_key_encrypted, `${ctx.workspace.id}:${provider.id}`) : ''; } catch { return record({ ok: false, status: 0, message: '密钥无法解密，请重新保存 API Key' }); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${safeTestUrl.toString().replace(/\/$/, '')}/models`, {
        headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return record({ ok: false, status: response.status, message: '认证失败，请检查 API Key' });
      if (response.status === 404) return record({ ok: true, status: 404, message: '端点可达，但未提供 /models；可保存后直接使用' });
      if (!response.ok) return record({ ok: false, status: response.status, message: `Provider 返回 ${response.status}` });
      const data = await response.json().catch(() => null) as { data?: unknown[] } | null;
      return record({ ok: true, status: response.status, message: '连接成功', modelCount: Array.isArray(data?.data) ? data.data.length : undefined });
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? '连接超时' : '无法连接 Provider';
      return record({ ok: false, status: 0, message });
    } finally {
      clearTimeout(timer);
    }
  });

  app.post('/api/w/:workspaceId/models', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const input = modelInputSchema.parse(request.body ?? {});
    const provider = providerFor(db, ctx.workspace.id, input.providerId);
    const duplicate = db.prepare('SELECT id FROM workspace_models WHERE workspace_id = ? AND model_id = ?').get(ctx.workspace.id, input.modelId);
    if (duplicate) throw conflict('该模型 ID 已在当前工作区配置');
    if (!input.enabled && totalModels(db, ctx.workspace.id) === 0) throw badRequest('第一个模型必须启用');
    if (!input.enabled && input.isDefault) throw badRequest('默认模型必须启用');
    const id = randomUUID();
    const timestamp = now();
    tx(db, () => {
      const count = totalModels(db, ctx.workspace.id);
      const makeDefault = input.enabled && (input.isDefault || count === 0);
      if (makeDefault) db.prepare('UPDATE workspace_models SET is_default = 0 WHERE workspace_id = ?').run(ctx.workspace.id);
      db.prepare(
        `INSERT INTO workspace_models (id, workspace_id, provider_id, model_id, label, context_window, enabled, is_default, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, ctx.workspace.id, provider.id, input.modelId, input.label, input.contextWindow, input.enabled ? 1 : 0, makeDefault ? 1 : 0, ctx.user.id, timestamp, timestamp);
      if (makeDefault) setDefaultSetting(db, ctx.workspace.id, input.modelId);
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'model.create', 'model', id, { modelId: input.modelId, provider: provider.name }, request.ip);
    return { model: serializeModel(modelFor(db, ctx.workspace.id, id)) };
  });

  app.patch('/api/w/:workspaceId/models/:id', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { id } = request.params as { id: string };
    const existing = modelFor(db, ctx.workspace.id, id);
    const input = modelPatchSchema.parse(request.body ?? {});
    if (input.providerId) providerFor(db, ctx.workspace.id, input.providerId);
    if (input.isDefault && input.enabled === false) throw badRequest('默认模型必须启用');
    if (input.enabled === false && existing.enabled && enabledModelCount(db, ctx.workspace.id) <= 1) {
      throw conflict('至少保留一个启用模型；如要回退平台默认，请删除全部模型');
    }
    if (input.modelId && input.modelId !== existing.model_id) {
      const duplicate = db.prepare('SELECT id FROM workspace_models WHERE workspace_id = ? AND model_id = ? AND id != ?').get(ctx.workspace.id, input.modelId, id);
      if (duplicate) throw conflict('该模型 ID 已在当前工作区配置');
    }
    tx(db, () => {
      const makeDefault = input.isDefault === true;
      const unsetDefault = input.isDefault === false && Boolean(existing.is_default);
      if (makeDefault) db.prepare('UPDATE workspace_models SET is_default = 0 WHERE workspace_id = ?').run(ctx.workspace.id);
      db.prepare(
        `UPDATE workspace_models SET provider_id = ?, model_id = ?, label = ?, context_window = ?, enabled = ?, is_default = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
      ).run(
        input.providerId ?? existing.provider_id,
        input.modelId ?? existing.model_id,
        input.label ?? existing.label,
        input.contextWindow ?? existing.context_window,
        input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        makeDefault ? 1 : unsetDefault ? 0 : existing.is_default,
        now(), id, ctx.workspace.id,
      );
      if (makeDefault) setDefaultSetting(db, ctx.workspace.id, input.modelId ?? existing.model_id);
      else if (existing.is_default && (input.modelId || input.providerId)) setDefaultSetting(db, ctx.workspace.id, input.modelId ?? existing.model_id);
      else if (unsetDefault || input.enabled === false) applyDefault(db, ctx.workspace.id);
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'model.update', 'model', id, { modelId: input.modelId ?? existing.model_id }, request.ip);
    return { model: serializeModel(modelFor(db, ctx.workspace.id, id)) };
  });

  app.delete('/api/w/:workspaceId/models/:id', async (request) => {
    const ctx = requireWorkspace(request, db, 'admin');
    const { id } = request.params as { id: string };
    const existing = modelFor(db, ctx.workspace.id, id);
    if (existing.enabled && totalModels(db, ctx.workspace.id) > 1 && enabledModelCount(db, ctx.workspace.id) <= 1) {
      throw conflict('删除后将没有可用模型；请先启用其他模型，或删除全部模型以回退平台默认');
    }
    tx(db, () => {
      db.prepare('DELETE FROM workspace_models WHERE id = ? AND workspace_id = ?').run(id, ctx.workspace.id);
      applyDefault(db, ctx.workspace.id);
    });
    audit(db, ctx.workspace.id, ctx.user.id, 'model.delete', 'model', id, { modelId: existing.model_id }, request.ip);
    return { ok: true };
  });
}
