import 'dotenv/config';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from './infrastructure/db.js';
import { config } from './config.js';

/** Consistent SQLite online backup. Never use cp on a WAL database. */
const backupDir = resolve(process.env.BACKUP_DIR ?? join(config.dataDir, 'backups'));
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `orbitwork-${stamp}.db`);
const db = openDb();
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`[backup] created ${target}`);

const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 14);
const cutoff = Date.now() - retentionDays * 86_400_000;
for (const file of readdirSync(backupDir)) {
  if (!file.endsWith('.db')) continue;
  const full = join(backupDir, file);
  if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
}
