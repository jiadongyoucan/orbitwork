import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

export type DB = DatabaseSync;

/**
 * Numbered, transactional migrations. PRAGMA user_version records the applied
 * version; every migration runs once and in a single transaction.
 * Never edit a shipped migration — append a new one.
 */
const MIGRATIONS: { version: number; name: string; sql?: string; run?: (db: DB) => void }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  platform_role TEXT NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','admin')),
  avatar TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_token ON sessions(token_hash);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'team',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  accepted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'sparkles',
  color TEXT NOT NULL DEFAULT '#c8f768',
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  connector_ids_json TEXT NOT NULL DEFAULT '[]',
  memory_enabled INTEGER NOT NULL DEFAULT 1,
  sandbox_enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_agents_ws ON agents(workspace_id);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '新会话',
  model TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_chats_ws ON chats(workspace_id, updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL DEFAULT '',
  tool_events_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'complete',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'workspace' CHECK (scope IN ('workspace','agent')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_memories_ws ON memories(workspace_id, updated_at DESC);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('expert','skill','connector','plugin')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'box',
  category TEXT NOT NULL DEFAULT '通用',
  payload_json TEXT NOT NULL DEFAULT '{}',
  secrets_encrypted TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','suspended')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','workspace','public')),
  author_id TEXT NOT NULL REFERENCES users(id),
  source_asset_id TEXT,
  installs INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, kind, slug)
);
CREATE INDEX idx_assets_ws ON assets(workspace_id, kind);
CREATE INDEX idx_assets_market ON assets(status, visibility, kind);

CREATE TABLE asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(asset_id, version)
);

CREATE TABLE asset_installs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  installed_asset_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  installed_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, asset_id)
);

CREATE TABLE asset_stars (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_ws ON audit_logs(workspace_id, created_at DESC);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_runs_chat ON runs(chat_id, started_at DESC);
`,
  },
  {
    version: 2,
    name: 'security hardening',
    sql: `
CREATE TABLE asset_installs_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  installed_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  installed_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, asset_id)
);
DELETE FROM asset_installs
  WHERE installed_asset_id NOT IN (SELECT id FROM assets)
     OR asset_id NOT IN (SELECT id FROM assets);
DELETE FROM asset_installs
  WHERE rowid NOT IN (SELECT MIN(rowid) FROM asset_installs GROUP BY workspace_id, asset_id);
INSERT INTO asset_installs_new (id, workspace_id, asset_id, installed_asset_id, source_version, installed_by, created_at)
  SELECT id, workspace_id, asset_id, installed_asset_id, source_version, installed_by, created_at FROM asset_installs;
DROP TABLE asset_installs;
ALTER TABLE asset_installs_new RENAME TO asset_installs;

CREATE TABLE platform_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_platform_audit ON platform_audit_logs(created_at DESC);
`,
  },
  {
    version: 3,
    name: 'workspace files',
    sql: `
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  text_preview TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);
CREATE INDEX idx_files_ws ON files(workspace_id, updated_at DESC);
`,
  },
  {
    version: 4,
    name: 'conversation trace + reasoning timing',
    run: (db) => {
      db.exec(`
CREATE TABLE IF NOT EXISTS trace_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  run_id TEXT,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_trace_chat ON trace_events(chat_id, seq);
`);
      // ALTER is skipped when the column (or the table) is already there, so a
      // partially migrated or legacy database cannot brick the boot.
      const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
      if (!columns.length) throw new Error('migration 4 requires the messages table');
      if (!columns.some((column) => column.name === 'run_id')) db.exec('ALTER TABLE messages ADD COLUMN run_id TEXT');
      if (!columns.some((column) => column.name === 'reasoning_ms')) db.exec('ALTER TABLE messages ADD COLUMN reasoning_ms INTEGER NOT NULL DEFAULT 0');
    },
  },
];

function runMigrations(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  let current = row?.user_version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (migration.run) migration.run(db);
      else db.exec(migration.sql ?? '');
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
      current = migration.version;
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${(error as Error).message}`);
    }
  }
}

function stripHeaders(kind: string, payload: Record<string, unknown>): boolean {
  let changed = false;
  if (kind === 'connector' && 'headers' in payload) {
    delete payload.headers;
    changed = true;
  }
  if (kind === 'plugin' && Array.isArray(payload.items)) {
    for (const item of payload.items as Array<{ kind?: string; payload?: Record<string, unknown> }>) {
      if (item.kind === 'connector' && item.payload && 'headers' in item.payload) {
        delete item.payload.headers;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * One-time/idempotent cleanup for databases created before connector headers
 * were removed from public payloads. Keeps legacy installs usable after upgrade.
 */
export function scrubLegacyHeaders(db: DB): void {
  db.exec('BEGIN IMMEDIATE');
  try {
  const assets = db.prepare("SELECT id, kind, payload_json FROM assets WHERE kind IN ('connector','plugin')").all() as Array<{ id: string; kind: string; payload_json: string }>;
  for (const row of assets) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(row.payload_json); } catch { continue; }
    if (stripHeaders(row.kind, payload)) {
      db.prepare('UPDATE assets SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), row.id);
    }
  }
  const versionColumns = db.prepare('PRAGMA table_info(asset_versions)').all() as Array<{ name: string }>;
  const hasContentHash = versionColumns.some((column) => column.name === 'content_hash');
  const versions = db.prepare("SELECT id, snapshot_json FROM asset_versions").all() as Array<{ id: string; snapshot_json: string }>;
  for (const row of versions) {
    let snapshot: Record<string, unknown>;
    try { snapshot = JSON.parse(row.snapshot_json); } catch { continue; }
    const kind = String(snapshot.kind ?? '');
    const payload = snapshot.payload as Record<string, unknown> | undefined;
    if (payload && stripHeaders(kind, payload)) {
      const next = JSON.stringify(snapshot);
      if (hasContentHash) {
        const hash = createHash('sha256').update(next).digest('hex');
        db.prepare('UPDATE asset_versions SET snapshot_json = ?, content_hash = ? WHERE id = ?').run(next, hash, row.id);
      } else {
        db.prepare('UPDATE asset_versions SET snapshot_json = ? WHERE id = ?').run(next, row.id);
      }
    }
  }
  db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDb(path = config.dbPath): DB {
  const file = path === ':memory:' ? path : resolve(path);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  runMigrations(db);
  scrubLegacyHeaders(db);
  return db;
}

export function now(): number {
  return Date.now();
}

export function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
