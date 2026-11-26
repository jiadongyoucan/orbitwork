import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { AppError } from '../domain/errors.js';
import { isTextLike, normalizeFileName } from '../domain/files.js';
import { now, type DB } from './db.js';

export type FileRow = {
  id: string;
  workspace_id: string;
  chat_id: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  storage_key: string;
  text_preview: string;
  created_by: string;
  created_at: number;
  updated_at: number;
};

/**
 * Files live at <DATA_DIR>/files/<workspaceId>/<fileId>. The on-disk name is a
 * UUID, so a hostile display name can never influence the path.
 */
export function storagePathFor(workspaceId: string, id: string): string {
  return join(resolve(config.files.dir), workspaceId, id);
}

export function usage(db: DB, workspaceId: string): { bytes: number; count: number } {
  const row = db.prepare('SELECT COUNT(*) as n, COALESCE(SUM(size), 0) as bytes FROM files WHERE workspace_id = ?').get(workspaceId) as
    | { n: number; bytes: number }
    | undefined;
  return { bytes: Number(row?.bytes ?? 0), count: Number(row?.n ?? 0) };
}

export function findByName(db: DB, workspaceId: string, name: string): FileRow | undefined {
  return db.prepare('SELECT * FROM files WHERE workspace_id = ? AND name = ?').get(workspaceId, name) as FileRow | undefined;
}

export function findById(db: DB, workspaceId: string, id: string): FileRow | undefined {
  return db.prepare('SELECT * FROM files WHERE id = ? AND workspace_id = ?').get(id, workspaceId) as FileRow | undefined;
}

export function putFile(
  db: DB,
  workspaceId: string,
  userId: string,
  rawName: string,
  rawMime: string,
  body: Buffer,
  role: 'owner' | 'admin' | 'member',
  chatId: string | null = null,
): FileRow {
  const name = normalizeFileName(rawName);
  if (!name) throw new AppError(400, 'INVALID_FILE_NAME', '文件名不合法（不能为空、不能含路径、最长 120 字符）');
  if (!body.length) throw new AppError(400, 'EMPTY_FILE', '文件内容为空');
  if (body.length > config.files.maxFileBytes) {
    throw new AppError(413, 'FILE_TOO_LARGE', `单个文件不能超过 ${Math.floor(config.files.maxFileBytes / 1024 / 1024)}MB`);
  }

  const existing = findByName(db, workspaceId, name);
  if (existing && existing.created_by !== userId && role === 'member') {
    throw new AppError(403, 'FILE_OWNED_BY_OTHER', '该文件由其他成员创建，只有创建者或管理员可以覆盖');
  }
  const stats = usage(db, workspaceId);
  const delta = body.length - (existing?.size ?? 0);
  if (stats.bytes + delta > config.files.maxWorkspaceBytes) {
    throw new AppError(409, 'WORKSPACE_QUOTA_EXCEEDED', `工作区存储已满（上限 ${Math.floor(config.files.maxWorkspaceBytes / 1024 / 1024)}MB），请先删除文件`);
  }
  if (!existing && stats.count >= config.files.maxCount) {
    throw new AppError(409, 'FILE_COUNT_EXCEEDED', `工作区文件数量已达上限（${config.files.maxCount} 个）`);
  }

  const id = existing?.id ?? randomUUID();
  const storageKey = `${workspaceId}/${id}`;
  const target = storagePathFor(workspaceId, id);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, body);
  renameSync(temp, target);

  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(rawMime) ? rawMime.slice(0, 120) : 'application/octet-stream';
  const textPreview = isTextLike(name, mime) ? body.subarray(0, 4000).toString('utf8') : '';
  const sha256 = createHash('sha256').update(body).digest('hex');
  const timestamp = now();

  if (existing) {
    db.prepare(
      `UPDATE files SET size = ?, mime = ?, sha256 = ?, text_preview = ?, chat_id = COALESCE(?, chat_id), updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).run(body.length, mime, sha256, textPreview, chatId, timestamp, id, workspaceId);
  } else {
    db.prepare(
      `INSERT INTO files (id, workspace_id, chat_id, name, mime, size, sha256, storage_key, text_preview, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, workspaceId, chatId, name, mime, body.length, sha256, storageKey, textPreview, userId, timestamp, timestamp);
  }
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow;
}

export function removeFile(db: DB, workspaceId: string, id: string): boolean {
  const row = findById(db, workspaceId, id);
  if (!row) return false;
  db.prepare('DELETE FROM files WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  rmSync(storagePathFor(workspaceId, id), { force: true });
  return true;
}

export function readText(row: FileRow, offset = 0, limit = 7000): { text: string; total: number; offset: number; truncated: boolean; windowLimited: boolean } {
  if (!isTextLike(row.name, row.mime)) throw new AppError(415, 'FILE_NOT_TEXT', '该文件不是文本，无法作为文本读取，请下载查看');
  const path = storagePathFor(row.workspace_id, row.id);
  if (!existsSync(path)) throw new AppError(404, 'FILE_MISSING', '文件内容已丢失，请重新上传');
  const size = statSync(path).size;
  const text = readFileSync(path).subarray(0, Math.min(size, config.files.readBytes)).toString('utf8');
  const start = Math.max(0, Math.min(offset, text.length));
  const chunk = text.slice(start, start + Math.max(1, limit));
  return {
    text: chunk,
    total: text.length,
    offset: start,
    truncated: start + chunk.length < text.length,
    windowLimited: size > config.files.readBytes,
  };
}

/** Removes stale upload temp files left behind by a crash. */
export function cleanupTempFiles(maxAgeMs = 3_600_000): number {
  const root = resolve(config.files.dir);
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const workspace of readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const dir = join(root, workspace.name);
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.tmp')) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).mtimeMs < Date.now() - maxAgeMs) {
          rmSync(full, { force: true });
          removed += 1;
        }
      } catch {
        /* ignore racing deletes */
      }
    }
  }
  return removed;
}

/** Deletes every file of a workspace from disk (row deletion cascades separately). */
export function removeWorkspaceFiles(workspaceId: string): void {
  rmSync(join(resolve(config.files.dir), workspaceId), { recursive: true, force: true });
}

export function fileExists(row: FileRow): boolean {
  return existsSync(storagePathFor(row.workspace_id, row.id));
}

export function publicFile(row: FileRow) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    text: isTextLike(row.name, row.mime),
    chatId: row.chat_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
