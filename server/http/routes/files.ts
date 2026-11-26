import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { config } from '../../config.js';
import { AppError, badRequest, forbidden, notFound } from '../../domain/errors.js';
import { isImageMime } from '../../domain/files.js';
import type { DB } from '../../infrastructure/db.js';
import { fileExists, findById, publicFile, putFile, readText, removeFile, storagePathFor, usage } from '../../infrastructure/files.js';
import { audit, requireWorkspace } from '../context.js';
import { checkRateKey } from '../rate-limit.js';

export async function fileRoutes(app: FastifyInstance, db: DB) {
  const canUseFiles = (settings: Record<string, unknown>) => settings.filesEnabled !== false;

  app.get('/api/w/:workspaceId/files', async (request) => {
    const ctx = requireWorkspace(request, db);
    if (!canUseFiles(ctx.workspace.settings)) throw forbidden('管理员已关闭工作区文件');
    const { q = '' } = request.query as { q?: string };
    const rows = db
      .prepare('SELECT * FROM files WHERE workspace_id = ? AND name LIKE ? ORDER BY updated_at DESC LIMIT ?')
      .all(ctx.workspace.id, `%${q.trim()}%`, config.files.maxCount) as Parameters<typeof publicFile>[0][];
    const stats = usage(db, ctx.workspace.id);
    return {
      files: rows.map(publicFile),
      usage: { bytes: stats.bytes, count: stats.count, maxBytes: config.files.maxWorkspaceBytes, maxCount: config.files.maxCount, maxFileBytes: config.files.maxFileBytes },
      role: ctx.role,
    };
  });

  app.post('/api/w/:workspaceId/files', { bodyLimit: config.files.maxFileBytes + 8192 }, async (request) => {
    const ctx = requireWorkspace(request, db);
    if (!canUseFiles(ctx.workspace.settings)) throw forbidden('管理员已关闭工作区文件');
    checkRateKey(`files:${ctx.user.id}`, 40, 60_000);
    const query = request.query as { name?: string; mime?: string; chatId?: string };
    if (!Buffer.isBuffer(request.body)) throw badRequest('请使用 Content-Type: application/octet-stream 上传原始字节');
    const file = putFile(
      db,
      ctx.workspace.id,
      ctx.user.id,
      String(query.name ?? ''),
      String(query.mime ?? 'application/octet-stream'),
      request.body,
      ctx.role,
      query.chatId ?? null,
    );
    audit(db, ctx.workspace.id, ctx.user.id, 'file.upload', 'file', file.id, { name: file.name, size: file.size }, request.ip);
    return { file: publicFile(file) };
  });

  app.get('/api/w/:workspaceId/files/:id/content', async (request, reply) => {
    const ctx = requireWorkspace(request, db);
    if (!canUseFiles(ctx.workspace.settings)) throw forbidden('管理员已关闭工作区文件');
    const row = findById(db, ctx.workspace.id, (request.params as { id: string }).id);
    if (!row || !fileExists(row)) throw notFound('文件不存在');
    const download = (request.query as { download?: string }).download === '1';
    const inline = !download && isImageMime(row.mime);
    reply.header('Content-Type', row.mime || 'application/octet-stream');
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(storagePathFor(row.workspace_id, row.id)));
  });

  app.get('/api/w/:workspaceId/files/:id/text', async (request) => {
    const ctx = requireWorkspace(request, db);
    if (!canUseFiles(ctx.workspace.settings)) throw forbidden('管理员已关闭工作区文件');
    const row = findById(db, ctx.workspace.id, (request.params as { id: string }).id);
    if (!row) throw notFound('文件不存在');
    const { text, truncated } = readText(row, 0, config.files.readBytes);
    return { name: row.name, mime: row.mime, size: row.size, text, truncated };
  });

  app.delete('/api/w/:workspaceId/files/:id', async (request) => {
    const ctx = requireWorkspace(request, db);
    if (!canUseFiles(ctx.workspace.settings)) throw forbidden('管理员已关闭工作区文件');
    const row = findById(db, ctx.workspace.id, (request.params as { id: string }).id);
    if (!row) throw notFound('文件不存在');
    if (row.created_by !== ctx.user.id && ctx.role === 'member') throw forbidden('只能删除自己上传的文件');
    if (!removeFile(db, ctx.workspace.id, row.id)) throw new AppError(404, 'FILE_NOT_FOUND', '文件不存在');
    audit(db, ctx.workspace.id, ctx.user.id, 'file.delete', 'file', row.id, { name: row.name }, request.ip);
    return { ok: true };
  });
}
