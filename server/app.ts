import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { openDb, type DB } from './infrastructure/db.js';
import { cleanupTempFiles } from './infrastructure/files.js';
import { AppError } from './domain/errors.js';
import { authRoutes } from './http/routes/auth.js';
import { workspaceRoutes } from './http/routes/workspaces.js';
import { agentRoutes } from './http/routes/agents.js';
import { memoryRoutes } from './http/routes/memories.js';
import { fileRoutes } from './http/routes/files.js';
import { assetRoutes } from './http/routes/assets.js';
import { chatRoutes } from './http/routes/chats.js';
import { adminRoutes } from './http/routes/admin.js';
import { miscRoutes } from './http/routes/misc.js';
import { seedDatabase } from './seed.js';
import { reconcileRunsOnBoot } from './application/agent-runtime.js';

export type AppOptions = {
  dbPath?: string;
  seed?: boolean;
  logger?: boolean;
};

function allowedOrigin(origin: string): boolean {
  const configured = config.appOrigin.split(',').map((value) => value.trim()).filter(Boolean);
  if (configured.includes(origin)) return true;
  if (config.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  if (config.nodeEnv === 'production' && (config.appSecret.startsWith('dev-only') || config.appSecret.includes('CHANGE_ME') || config.appSecret.length < 32)) {
    throw new Error('APP_SECRET must be set to a unique 32+ character value in production');
  }
  const db: DB = openDb(options.dbPath ?? config.dbPath);
  cleanupTempFiles();
  reconcileRunsOnBoot(db);
  if (options.seed !== false) await seedDatabase(db);
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 1_000_000,
    disableRequestLogging: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && origin && !allowedOrigin(origin)) {
      return reply.code(403).send({ error: { code: 'BAD_ORIGIN', message: '请求来源不被允许' } });
    }
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.url.startsWith('/api/') && Number(request.headers['content-length'] ?? 0) > 0) {
      const rawUpload = /^\/api\/w\/[^/?]+\/files(?:\?|$)/.test(request.url) && /^(application\/octet-stream|text\/)/.test(String(request.headers['content-type'] ?? ''));
      if (!rawUpload && !String(request.headers['content-type'] ?? '').includes('application/json')) {
        return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '仅支持 application/json 请求体' } });
      }
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: '输入内容不合法', details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const message = statusCode === 413 ? '请求体过大' : statusCode === 415 ? '不支持的 Content-Type' : '请求格式不正确';
      return reply.code(statusCode).send({ error: { code: 'BAD_REQUEST', message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } });
  });

  await app.register(cookie);
  // Raw byte uploads are only accepted on the workspace file routes.
  app.addContentTypeParser(
    ['application/octet-stream', 'text/plain', 'text/markdown', 'text/csv'],
    { parseAs: 'buffer', bodyLimit: config.files.maxFileBytes + 8192 },
    (_request, body, done) => { done(null, body); },
  );
  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  await miscRoutes(app, db);
  await authRoutes(app, db);
  await workspaceRoutes(app, db);
  await agentRoutes(app, db);
  await memoryRoutes(app, db);
  await fileRoutes(app, db);
  await assetRoutes(app, db);
  await chatRoutes(app, db);
  await adminRoutes(app, db);

  const publicDir = resolve('dist/public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
      }
      if (request.url.startsWith('/assets/')) return reply.code(404).type('text/plain').send('Not found');
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
      }
      return reply.code(200).type('text/html').send('<!doctype html><html><body style="font-family:system-ui;background:#0b0c0e;color:#eee;padding:40px"><h1>OrbitWork API</h1><p>前端开发服务器请访问 <a style="color:#c8f768" href="http://localhost:5173">http://localhost:5173</a></p></body></html>');
    });
  }

  return app;
}
