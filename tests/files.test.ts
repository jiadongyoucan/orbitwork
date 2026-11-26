import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { resetRates } from '../server/http/rate-limit.js';

let app: FastifyInstance;
let filesDir: string;
let counter = 0;

type Session = { cookie: string; workspaceId: string; email: string };

before(async () => {
  filesDir = mkdtempSync(join(tmpdir(), 'orbit-files-'));
  config.files.dir = filesDir;
  app = await createApp({ dbPath: ':memory:', seed: false, logger: false });
  await app.ready();
});

after(async () => { await app.close(); });
beforeEach(() => resetRates());

async function signup(name = 'File User'): Promise<Session> {
  counter += 1;
  resetRates();
  const response = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { name, email: `files${counter}@example.test`, password: 'CorrectHorse!2026', workspaceName: `${name} 的空间` },
  });
  assert.equal(response.statusCode, 200, response.body);
  const raw = response.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0];
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return { cookie, workspaceId: me.json().workspaces[0].id, email: `files${counter}@example.test` };
}

function upload(session: Session, name: string, body: Buffer | string, mime = 'text/plain') {
  const query = `name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`;
  return app.inject({
    method: 'POST',
    url: `/api/w/${session.workspaceId}/files?${query}`,
    headers: { cookie: session.cookie, 'content-type': 'application/octet-stream' },
    payload: typeof body === 'string' ? Buffer.from(body) : body,
  });
}

async function json(session: Session, method: string, url: string, payload?: unknown) {
  const response = await app.inject({
    method: method as 'GET', url,
    headers: { cookie: session.cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: response.json() };
}

test('files: upload, list, text preview, download and delete', async () => {
  const session = await signup();
  const created = await upload(session, 'notes.md', '# Hello\nworld', 'text/markdown');
  assert.equal(created.statusCode, 200, created.body);
  const file = created.json().file;
  assert.equal(file.name, 'notes.md');
  assert.equal(file.size, 13);
  assert.equal(file.text, true);
  assert.ok(existsSync(join(filesDir, session.workspaceId, file.id)));

  const list = await json(session, 'GET', `/api/w/${session.workspaceId}/files`);
  assert.equal(list.body.files.length, 1);
  assert.equal(list.body.usage.count, 1);
  assert.equal(list.body.usage.bytes, 13);

  const text = await json(session, 'GET', `/api/w/${session.workspaceId}/files/${file.id}/text`);
  assert.match(text.body.text, /Hello/);
  assert.equal(text.body.truncated, false);

  const download = await app.inject({
    method: 'GET', url: `/api/w/${session.workspaceId}/files/${file.id}/content?download=1`,
    headers: { cookie: session.cookie },
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, '# Hello\nworld');
  assert.match(String(download.headers['content-disposition']), /attachment/);

  const removed = await json(session, 'DELETE', `/api/w/${session.workspaceId}/files/${file.id}`);
  assert.equal(removed.body.ok, true);
  assert.equal(existsSync(join(filesDir, session.workspaceId, file.id)), false);
});

test('files: same name overwrites instead of duplicating', async () => {
  const session = await signup();
  const first = await upload(session, 'plan.md', 'v1');
  const second = await upload(session, 'plan.md', 'version two');
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().file.id, first.json().file.id);
  const list = await json(session, 'GET', `/api/w/${session.workspaceId}/files`);
  assert.equal(list.body.files.length, 1);
  assert.equal(list.body.files[0].size, 11);
});

test('files: traversal names are sanitized, never used as paths', async () => {
  const session = await signup();
  const created = await upload(session, '../../etc/passwd', 'x');
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().file.name, 'passwd');
  assert.ok(existsSync(join(filesDir, session.workspaceId, created.json().file.id)));
});

test('files: per-file size and workspace quota are enforced', async () => {
  const session = await signup();
  const originalFile = config.files.maxFileBytes;
  const originalQuota = config.files.maxWorkspaceBytes;
  try {
    config.files.maxFileBytes = 8;
    const tooBig = await upload(session, 'big.txt', '0123456789');
    assert.equal(tooBig.statusCode, 413, tooBig.body);
    assert.equal(tooBig.json().error.code, 'FILE_TOO_LARGE');

    config.files.maxFileBytes = originalFile;
    config.files.maxWorkspaceBytes = 5;
    const overQuota = await upload(session, 'quota.txt', '0123456789');
    assert.equal(overQuota.statusCode, 409, overQuota.body);
    assert.equal(overQuota.json().error.code, 'WORKSPACE_QUOTA_EXCEEDED');
  } finally {
    config.files.maxFileBytes = originalFile;
    config.files.maxWorkspaceBytes = originalQuota;
  }
});

test('files: binary is not previewable, JSON body is rejected', async () => {
  const session = await signup();
  const created = await upload(session, 'data.bin', Buffer.from([0, 1, 2, 3]), 'application/octet-stream');
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().file.text, false);
  const text = await json(session, 'GET', `/api/w/${session.workspaceId}/files/${created.json().file.id}/text`);
  assert.equal(text.status, 415);
  assert.equal(text.body.error.code, 'FILE_NOT_TEXT');

  const wrongType = await app.inject({
    method: 'POST', url: `/api/w/${session.workspaceId}/files?name=evil.txt`,
    headers: { cookie: session.cookie, 'content-type': 'application/json' },
    payload: { name: 'evil.txt' },
  });
  assert.ok([400, 415].includes(wrongType.statusCode), wrongType.body);
});

test('files: other tenants get 404 and settings can disable the feature', async () => {
  const owner = await signup('Owner');
  const stranger = await signup('Stranger');
  const created = await upload(owner, 'secret.md', 'private');
  const fileId = created.json().file.id;

  const peek = await json(stranger, 'GET', `/api/w/${owner.workspaceId}/files/${fileId}/text`);
  assert.equal(peek.status, 404);
  const remove = await json(stranger, 'DELETE', `/api/w/${owner.workspaceId}/files/${fileId}`);
  assert.equal(remove.status, 404);

  const off = await json(owner, 'PATCH', `/api/w/${owner.workspaceId}/settings`, { filesEnabled: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const blocked = await upload(owner, 'blocked.md', 'nope');
  assert.equal(blocked.statusCode, 403, blocked.body);
  const listBlocked = await json(owner, 'GET', `/api/w/${owner.workspaceId}/files`);
  assert.equal(listBlocked.status, 403);

  await json(owner, 'PATCH', `/api/w/${owner.workspaceId}/settings`, { filesEnabled: true });
  const restored = await json(owner, 'GET', `/api/w/${owner.workspaceId}/files`);
  assert.equal(restored.status, 200);
});

async function invite(session: Session, email: string): Promise<string> {
  const response = await json(session, 'POST', `/api/w/${session.workspaceId}/invites`, { email, role: 'member' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return String(response.body.inviteUrl).replace('/invite/', '');
}

function uploadTo(workspaceId: string, cookie: string, name: string, body: string, mime = 'text/plain') {
  const query = `name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`;
  return app.inject({
    method: 'POST', url: `/api/w/${workspaceId}/files?${query}`,
    headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: Buffer.from(body),
  });
}

test('files: members cannot overwrite another member\'s file', async () => {
  const owner = await signup('Owner X');
  const member = await signup('Member Y');
  const token = await invite(owner, member.email);
  const accepted = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: member.cookie } });
  assert.equal(accepted.statusCode, 200, accepted.body);

  const created = await upload(owner, 'shared.md', 'owner text');
  const hijack = await uploadTo(owner.workspaceId, member.cookie, 'shared.md', 'hijacked');
  assert.equal(hijack.statusCode, 403, hijack.body);
  assert.equal(hijack.json().error.code, 'FILE_OWNED_BY_OTHER');

  const text = await json(owner, 'GET', `/api/w/${owner.workspaceId}/files/${created.json().file.id}/text`);
  assert.equal(text.body.text, 'owner text');

  const own = await uploadTo(owner.workspaceId, member.cookie, 'member-note.md', 'mine');
  assert.equal(own.statusCode, 200, own.body);
});

test('files: quota accounting follows overwrite and delete', async () => {
  const session = await signup();
  await upload(session, 'q.md', '12345');
  let list = await json(session, 'GET', `/api/w/${session.workspaceId}/files`);
  assert.equal(list.body.usage.bytes, 5);
  await upload(session, 'q.md', '1234567890');
  list = await json(session, 'GET', `/api/w/${session.workspaceId}/files`);
  assert.equal(list.body.usage.bytes, 10);
  assert.equal(list.body.usage.count, 1);
  await json(session, 'DELETE', `/api/w/${session.workspaceId}/files/${list.body.files[0].id}`);
  list = await json(session, 'GET', `/api/w/${session.workspaceId}/files`);
  assert.equal(list.body.usage.bytes, 0);
  assert.equal(list.body.usage.count, 0);
});

test('files: disabling the feature blocks content and text too', async () => {
  const session = await signup();
  const created = await upload(session, 'off.md', 'closed');
  const fileId = created.json().file.id;
  await json(session, 'PATCH', `/api/w/${session.workspaceId}/settings`, { filesEnabled: false });
  for (const suffix of ['content', 'text']) {
    const response = await app.inject({
      method: 'GET', url: `/api/w/${session.workspaceId}/files/${fileId}/${suffix}`,
      headers: { cookie: session.cookie },
    });
    assert.equal(response.statusCode, 403, `${suffix} -> ${response.statusCode}`);
  }
  await json(session, 'PATCH', `/api/w/${session.workspaceId}/settings`, { filesEnabled: true });
});

test('files: html/svg never render inline, png does', async () => {
  const session = await signup();
  const html = await upload(session, 'x.html', '<script>alert(1)</script>', 'text/html');
  const svg = await upload(session, 'pic.svg', '<svg onload="alert(1)"></svg>', 'image/svg+xml');
  const png = await upload(session, 'pic.png', '89504e47', 'image/png');
  const header = async (fileId: string) => {
    const response = await app.inject({ method: 'GET', url: `/api/w/${session.workspaceId}/files/${fileId}/content`, headers: { cookie: session.cookie } });
    return String(response.headers['content-disposition']);
  };
  assert.match(await header(html.json().file.id), /^attachment/);
  assert.match(await header(svg.json().file.id), /^attachment/);
  assert.match(await header(png.json().file.id), /^inline/);
});

test('files: hostile mime falls back to octet-stream', async () => {
  const session = await signup();
  const created = await upload(session, 'weird.bin', 'x', 'text/plain;\r\nX-Injected: 1');
  assert.equal(created.statusCode, 200, created.body);
  const response = await app.inject({ method: 'GET', url: `/api/w/${session.workspaceId}/files/${created.json().file.id}/content`, headers: { cookie: session.cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
});
