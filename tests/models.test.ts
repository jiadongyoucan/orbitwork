import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { resetRates } from '../server/http/rate-limit.js';
import { listEffectiveModels, resolveWorkspaceModel } from '../server/application/model-registry.js';

let app: FastifyInstance;
let seq = 0;

before(async () => {
  app = await createApp({ dbPath: ':memory:', seed: false, logger: false });
  await app.ready();
});
after(async () => { await app.close(); });

async function signup(): Promise<{ cookie: string; workspaceId: string; email: string }> {
  seq += 1;
  const email = `models${seq}@example.test`;
  resetRates();
  const response = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { name: `Model User ${seq}`, email, password: 'CorrectHorse!2026', workspaceName: `Models ${seq}` },
  });
  assert.equal(response.statusCode, 200, response.body);
  const setCookie = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0];
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  const workspaceId = me.json().workspaces[0].id;
  return { cookie, workspaceId, email };
}

async function call(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as any, url, headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
}

test('models: env fallback works before any provider is configured', async () => {
  const owner = await signup();
  const response = await call('GET', `/api/w/${owner.workspaceId}/models`, owner.cookie);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.models.length >= 1);
  assert.equal(body.models[0].source, 'system');
});

test('models: provider keys are encrypted and never returned; admin CRUD works', async () => {
  const owner = await signup();
  const created = await call('POST', `/api/w/${owner.workspaceId}/providers`, owner.cookie, {
    name: 'Example Provider', baseUrl: 'https://example.com/v1', apiKey: 'sk-model-secret', enabled: true,
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().provider.hasKey, true);
  assert.ok(!created.body.includes('sk-model-secret'));
  const providerId = created.json().provider.id;

  const raw = (app as any).db.prepare('SELECT api_key_encrypted FROM providers WHERE id = ?').get(providerId) as { api_key_encrypted: string };
  assert.match(raw.api_key_encrypted, /^v2\./);
  assert.ok(!raw.api_key_encrypted.includes('sk-model-secret'));

  const model = await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId, modelId: 'example-large', label: 'Example Large', contextWindow: 64000, enabled: true, isDefault: true,
  });
  assert.equal(model.statusCode, 200, model.body);
  assert.equal(model.json().model.isDefault, true);

  const settings = await call('GET', `/api/w/${owner.workspaceId}/model-settings`, owner.cookie);
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().configured, true);
  assert.equal(settings.json().defaultModel, 'example-large');
  assert.ok(!settings.body.includes('sk-model-secret'));
  assert.equal(settings.json().models[0].providerName, 'Example Provider');

  const effective = listEffectiveModels((app as any).db, owner.workspaceId);
  assert.equal(effective.length, 1);
  assert.equal(effective[0].source, 'workspace');
  const resolved = resolveWorkspaceModel((app as any).db, owner.workspaceId, 'example-large');
  assert.equal(resolved.apiKey, 'sk-model-secret');
  assert.equal(resolved.contextWindow, 64000);
});

test('models: members can read effective models but cannot mutate configuration', async () => {
  const owner = await signup();
  const member = await signup();
  const invite = await call('POST', `/api/w/${owner.workspaceId}/invites`, owner.cookie, { email: member.email, role: 'member' });
  const token = invite.json().inviteUrl.split('/').pop();
  const accepted = await call('POST', `/api/invites/${token}/accept`, member.cookie);
  assert.equal(accepted.statusCode, 200, accepted.body);

  const provider = await call('POST', `/api/w/${owner.workspaceId}/providers`, owner.cookie, {
    name: 'Shared Provider', baseUrl: 'https://example.com/v1', apiKey: 'sk-shared', enabled: true,
  });
  await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId: provider.json().provider.id, modelId: 'shared-model', label: 'Shared Model', contextWindow: 32000, enabled: true, isDefault: true,
  });

  const visible = await call('GET', `/api/w/${owner.workspaceId}/models`, member.cookie);
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.json().models[0].id, 'shared-model');
  assert.equal(visible.json().models[0].providerName, 'Shared Provider');

  const forbiddenProvider = await call('POST', `/api/w/${owner.workspaceId}/providers`, member.cookie, {
    name: 'No', baseUrl: 'https://example.com/v1', enabled: true,
  });
  assert.equal(forbiddenProvider.statusCode, 403);
  const forbiddenSettings = await call('GET', `/api/w/${owner.workspaceId}/model-settings`, member.cookie);
  assert.equal(forbiddenSettings.statusCode, 403);
});

test('models: deleting a provider repoints the workspace default safely', async () => {
  const owner = await signup();
  const provider = await call('POST', `/api/w/${owner.workspaceId}/providers`, owner.cookie, {
    name: 'Delete Me', baseUrl: 'https://example.com/v1', enabled: true,
  });
  await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId: provider.json().provider.id, modelId: 'delete-me', label: 'Delete Me', contextWindow: 16000, enabled: true, isDefault: true,
  });
  const deleted = await call('DELETE', `/api/w/${owner.workspaceId}/providers/${provider.json().provider.id}`, owner.cookie);
  assert.equal(deleted.statusCode, 200);
  const models = await call('GET', `/api/w/${owner.workspaceId}/models`, owner.cookie);
  assert.equal(models.statusCode, 200);
  assert.equal(models.json().models[0].source, 'system');
});

test('models: defaults stay consistent and the last enabled model cannot be stranded', async () => {
  const owner = await signup();
  const provider = await call('POST', `/api/w/${owner.workspaceId}/providers`, owner.cookie, {
    name: 'Default Provider', baseUrl: 'https://example.com/v1', enabled: true,
  });
  const providerId = provider.json().provider.id;
  const disabled = await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId, modelId: 'disabled-first', label: 'Disabled First', contextWindow: 32000, enabled: false, isDefault: false,
  });
  assert.equal(disabled.statusCode, 400, 'the first model must be enabled');

  const first = await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId, modelId: 'default-a', label: 'Default A', contextWindow: 32000, enabled: true, isDefault: true,
  });
  const second = await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId, modelId: 'default-b', label: 'Default B', contextWindow: 32000, enabled: true, isDefault: false,
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);

  const selected = await call('PATCH', `/api/w/${owner.workspaceId}/settings`, owner.cookie, { defaultModel: 'default-b' });
  assert.equal(selected.statusCode, 200, selected.body);
  const reread = await call('GET', `/api/w/${owner.workspaceId}/settings`, owner.cookie);
  assert.equal(reread.json().settings.defaultModel, 'default-b');
  const stored = (app as any).db.prepare("SELECT is_default FROM workspace_models WHERE workspace_id = ? AND model_id = 'default-b'").get(owner.workspaceId) as { is_default: number };
  assert.equal(stored.is_default, 1);

  const disableOther = await call('PATCH', `/api/w/${owner.workspaceId}/models/${second.json().model.id}`, owner.cookie, { enabled: false });
  assert.equal(disableOther.statusCode, 200, 'one other model remains enabled');
  const disableLast = await call('PATCH', `/api/w/${owner.workspaceId}/models/${first.json().model.id}`, owner.cookie, { enabled: false });
  assert.equal(disableLast.statusCode, 409);
});

test('models: an encrypted key that cannot decrypt fails closed and is reported', async () => {
  const owner = await signup();
  const provider = await call('POST', `/api/w/${owner.workspaceId}/providers`, owner.cookie, {
    name: 'Broken Key', baseUrl: 'https://example.com/v1', apiKey: 'sk-broken', enabled: true,
  });
  const providerId = provider.json().provider.id as string;
  await call('POST', `/api/w/${owner.workspaceId}/models`, owner.cookie, {
    providerId, modelId: 'broken-key-model', label: 'Broken Key Model', contextWindow: 32000, enabled: true, isDefault: true,
  });
  (app as any).db.prepare('UPDATE providers SET api_key_encrypted = ? WHERE id = ?').run('v2.1.bad.bad.bad', providerId);
  const settings = await call('GET', `/api/w/${owner.workspaceId}/model-settings`, owner.cookie);
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().providers[0].keyError, true);
  const effective = listEffectiveModels((app as any).db, owner.workspaceId);
  assert.equal(effective[0].keyError, true);
  assert.throws(() => resolveWorkspaceModel((app as any).db, owner.workspaceId, 'broken-key-model'), /密钥无法解密/);
});

test('models: private provider URLs are rejected unless explicitly enabled', async () => {
  const owner = await signup();
  const response = await call('POST', `/api/w/${owner.workspaceId}/providers`, owner.cookie, {
    name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1', enabled: true,
  });
  assert.equal(response.statusCode, 400);
});
