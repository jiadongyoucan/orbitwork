import type { DB } from '../infrastructure/db.js';
import { config, defaultModel as envDefaultModel, models as envModels } from '../config.js';
import { decryptSecretWithAad } from '../domain/security.js';
import { badRequest } from '../domain/errors.js';

export type ProviderRow = {
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

export type WorkspaceModelRow = {
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
  base_url?: string;
  api_key_encrypted?: string;
  provider_enabled?: number;
};

export type EffectiveModel = {
  id: string;
  label: string;
  providerId: string | null;
  providerName: string;
  contextWindow: number;
  source: 'workspace' | 'system';
  isDefault: boolean;
  hasKey: boolean;
  keyError: boolean;
  demo: boolean;
};

export type ResolvedModel = EffectiveModel & {
  baseUrl: string;
  apiKey: string;
};

function apiKeyOf(row: WorkspaceModelRow): { key: string; error: boolean } {
  if (!row.api_key_encrypted) return { key: '', error: false };
  try {
    return { key: decryptSecretWithAad(row.api_key_encrypted, `${row.workspace_id}:${row.provider_id}`), error: false };
  } catch {
    return { key: '', error: true };
  }
}

function fromWorkspaceRow(row: WorkspaceModelRow): ResolvedModel {
  const secret = apiKeyOf(row);
  const apiKey = secret.key;
  return {
    id: row.model_id,
    label: row.label,
    providerId: row.provider_id,
    providerName: String(row.provider_name ?? 'Provider'),
    baseUrl: String(row.base_url ?? ''),
    apiKey,
    contextWindow: row.context_window || config.llm.contextWindow,
    source: 'workspace',
    isDefault: Boolean(row.is_default),
    hasKey: Boolean(row.api_key_encrypted),
    keyError: secret.error,
    demo: !row.api_key_encrypted,
  };
}

export function configuredModelRows(db: DB, workspaceId: string): WorkspaceModelRow[] {
  return db
    .prepare(
      `SELECT m.*, p.name as provider_name, p.base_url, p.api_key_encrypted, p.enabled as provider_enabled
       FROM workspace_models m JOIN providers p ON p.id = m.provider_id
       WHERE m.workspace_id = ? AND m.enabled = 1 AND p.enabled = 1
       ORDER BY m.is_default DESC, m.created_at ASC`,
    )
    .all(workspaceId) as WorkspaceModelRow[];
}

export function workspaceHasModels(db: DB, workspaceId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM workspace_models WHERE workspace_id = ? LIMIT 1').get(workspaceId));
}

export function listEffectiveModels(db: DB, workspaceId: string): EffectiveModel[] {
  const configured = configuredModelRows(db, workspaceId);
  if (workspaceHasModels(db, workspaceId)) {
    return configured.map((row) => {
      const model = fromWorkspaceRow(row);
      return {
        id: model.id, label: model.label, providerId: model.providerId, providerName: model.providerName,
        contextWindow: model.contextWindow, source: model.source, isDefault: model.isDefault,
        hasKey: model.hasKey, keyError: model.keyError, demo: model.demo,
      };
    });
  }
  const hasKey = Boolean(config.llm.apiKey);
  return envModels().map((model, index) => ({
    id: model.id,
    label: model.label,
    providerId: null,
    providerName: '平台默认',
    contextWindow: config.llm.contextWindow,
    source: 'system' as const,
    isDefault: index === 0,
    hasKey,
    keyError: false,
    demo: !hasKey,
  }));
}

/** Runtime resolver: prefers the requested model, then default/first effective model. */
export function resolveWorkspaceModel(db: DB, workspaceId: string, requested: string): ResolvedModel {
  const configured = configuredModelRows(db, workspaceId);
  if (workspaceHasModels(db, workspaceId)) {
    const row = configured.find((item) => item.model_id === requested)
      ?? configured.find((item) => Boolean(item.is_default))
      ?? configured[0];
    if (!row) throw badRequest('工作区尚未启用可用模型，请在「模型与 Provider」中启用');
    const resolved = fromWorkspaceRow(row);
    if (resolved.keyError) throw badRequest('模型密钥无法解密，请管理员在「模型与 Provider」中重新保存 API Key');
    return resolved;
  }
  const options = envModels();
  const picked = options.find((item) => item.id === requested) ?? options[0];
  return {
    id: picked?.id ?? envDefaultModel(),
    label: picked?.label ?? envDefaultModel(),
    providerId: null,
    providerName: '平台默认',
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    contextWindow: config.llm.contextWindow,
    source: 'system',
    isDefault: true,
    hasKey: Boolean(config.llm.apiKey),
    keyError: false,
    demo: !config.llm.apiKey,
  };
}

/** Strict validation for writes (chat create, agent, workspace settings). */
export function assertWorkspaceModel(db: DB, workspaceId: string, requested: string): EffectiveModel {
  const list = listEffectiveModels(db, workspaceId);
  const selected = list.find((item) => item.id === requested);
  if (!selected) throw badRequest('模型不在当前工作区的允许列表内');
  return selected;
}

export function workspaceDefaultModel(db: DB, workspaceId: string, fallback = ''): string {
  const list = listEffectiveModels(db, workspaceId);
  const preferred = fallback ? list.find((item) => item.id === fallback) : undefined;
  if (workspaceHasModels(db, workspaceId)) return preferred?.id ?? list.find((item) => item.isDefault)?.id ?? list[0]?.id ?? '';
  return preferred?.id ?? list.find((item) => item.isDefault)?.id ?? list[0]?.id ?? fallback ?? envDefaultModel();
}
