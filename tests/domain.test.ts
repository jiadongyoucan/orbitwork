import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, slugify } from '../server/domain/security.js';
import { hasRole, assertRole } from '../server/domain/errors.js';
import { redactSecrets } from '../server/domain/redact.js';
import { validateAssetPayload } from '../server/domain/schemas.js';
import { assertSafeUrl } from '../server/infrastructure/connectors.js';
import { openDb } from '../server/infrastructure/db.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('passwords are salted, verifiable and reject wrong input', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second, 'hashes must use unique salts');
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
});

test('connector secrets round-trip and tamper detection', () => {
  const encrypted = encryptSecret(JSON.stringify({ Authorization: 'Bearer secret' }), 'unit-test-key');
  assert.equal(JSON.parse(decryptSecret(encrypted, 'unit-test-key')).Authorization, 'Bearer secret');
  const parts = encrypted.split('.');
  const tag = Buffer.from(parts[2], 'base64url');
  tag[0] ^= 0xff;
  parts[2] = tag.toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), 'unit-test-key'));
});

test('workspace role hierarchy is enforced', () => {
  assert.equal(hasRole('owner', 'admin'), true);
  assert.equal(hasRole('member', 'admin'), false);
  assert.throws(() => assertRole('member', 'owner'));
});

test('SSRF guard blocks localhost, private and metadata addresses', async () => {
  for (const url of ['http://localhost:8080/x', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.4/', 'file:///etc/passwd']) {
    await assert.rejects(() => assertSafeUrl(url), `expected ${url} to be rejected`);
  }
});

test('asset payload validation normalizes and rejects malformed connectors', () => {
  const skill = validateAssetPayload('skill', { instructions: 'A'.repeat(30), outputFormat: 'markdown' });
  assert.equal(skill.outputFormat, 'markdown');
  assert.throws(() => validateAssetPayload('connector', { method: 'POST', url: 'not-a-url', toolName: 'x' }));
  assert.throws(() => validateAssetPayload('plugin', { items: [] }), 'plugins must contain at least one item');
});

test('plugin manifest caps items and validates nested payloads', () => {
  const items = Array.from({ length: 11 }, (_, index) => ({
    kind: 'skill', name: `s${index}`, summary: '', payload: { instructions: 'x'.repeat(30) },
  }));
  assert.throws(() => validateAssetPayload('plugin', { items }));
  const valid = validateAssetPayload('plugin', {
    items: [{ kind: 'skill', name: 'Research', summary: 'brief', payload: { instructions: 'x'.repeat(30) } }],
  });
  assert.equal((valid.items as unknown[]).length, 1);
});

test('slugs stay URL-safe for latin and Chinese names', () => {
  assert.equal(slugify('Growth Lab'), 'growth-lab');
  assert.match(slugify('增长 实验'), /^[a-z0-9\u4e00-\u9fa5-]+$/);
});

test('file database migrates to the latest version and supports consistent backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-db-test-'));
  try {
    const path = join(dir, 'test.db');
    const db = openDb(path);
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(version.user_version, 5);
    db.prepare("INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.test','A','x',1)").run();
    const backup = join(dir, 'backup.db');
    db.exec(`VACUUM INTO '${backup}'`);
    db.close();
    assert.equal(existsSync(backup), true);
    const restored = openDb(backup);
    assert.equal((restored.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n, 1);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy v1 orphan installs and plaintext headers are cleaned during upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-legacy-'));
  try {
    const path = join(dir, 'legacy.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE messages (id TEXT PRIMARY KEY);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY);
      CREATE TABLE assets (id TEXT PRIMARY KEY, kind TEXT, payload_json TEXT);
      CREATE TABLE asset_versions (id TEXT PRIMARY KEY, snapshot_json TEXT, content_hash TEXT);
      CREATE TABLE asset_installs (
        id TEXT PRIMARY KEY, workspace_id TEXT, asset_id TEXT, installed_asset_id TEXT,
        source_version TEXT, installed_by TEXT, created_at INTEGER, UNIQUE(workspace_id, asset_id)
      );
      INSERT INTO users (id) VALUES ('u1');
      INSERT INTO workspaces (id) VALUES ('w1');
      INSERT INTO assets (id, kind, payload_json) VALUES ('a1', 'connector', '{"url":"https://example.com","toolName":"x","parameters":{},"headers":{"Authorization":"legacy-secret"}}');
      INSERT INTO asset_versions (id, snapshot_json, content_hash) VALUES ('v1', '{"kind":"connector","payload":{"url":"https://example.com","headers":{"Authorization":"legacy-secret"}}}', 'old-hash');
      INSERT INTO asset_installs VALUES ('i1', 'w1', 'a1', 'missing-clone', '1.0.0', 'u1', 1);
      PRAGMA user_version = 1;
    `);
    legacy.close();
    const db = openDb(path);
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(version.user_version, 5);
    assert.equal((db.prepare('SELECT COUNT(*) as n FROM asset_installs').get() as { n: number }).n, 0);
    const asset = db.prepare("SELECT payload_json FROM assets WHERE id = 'a1'").get() as { payload_json: string };
    assert.equal(JSON.parse(asset.payload_json).headers, undefined);
    const snapshot = db.prepare("SELECT snapshot_json FROM asset_versions WHERE id = 'v1'").get() as { snapshot_json: string };
    assert.equal(JSON.parse(snapshot.snapshot_json).payload.headers, undefined);
    const updatedHash = db.prepare("SELECT content_hash FROM asset_versions WHERE id = 'v1'").get() as { content_hash: string };
    assert.notEqual(updatedHash.content_hash, 'old-hash');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redaction removes keys, bearer tokens and URL query strings', () => {
  const raw = 'model request failed (401) key sk-abc123456789 Bearer eyJhbGciOi.xx?token=1 https://api.example.com/v1?api_key=secret&x=1';
  const safe = redactSecrets(raw);
  assert.equal(safe.includes('sk-abc123456789'), false);
  assert.equal(safe.includes('eyJhbGciOi'), false);
  assert.equal(safe.includes('api_key=secret'), false);
  assert.match(safe, /api\.example\.com\/v1\?…/);
});

test('a v3 database upgrades to the latest schema and gains the trace columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-v3-'));
  try {
    const path = join(dir, 'v3.db');
    let db = openDb(path);
    db.exec('DROP TABLE trace_events');
    db.exec('ALTER TABLE messages DROP COLUMN run_id');
    db.exec('ALTER TABLE messages DROP COLUMN reasoning_ms');
    db.exec('PRAGMA user_version = 3');
    db.close();

    db = openDb(path);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 5);
    const columns = (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map((column) => column.name);
    assert.ok(columns.includes('run_id'), 'run_id added');
    assert.ok(columns.includes('reasoning_ms'), 'reasoning_ms added');
    const trace = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trace_events'").get();
    assert.ok(trace, 'trace_events created');
    const providers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providers'").get();
    assert.ok(providers, 'providers created');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
