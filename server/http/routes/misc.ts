import type { FastifyInstance } from 'fastify';
import type { DB } from '../../infrastructure/db.js';
import { requireUser, requireWorkspace } from '../context.js';
import { models, isDemoLlm } from '../../config.js';
import { sandboxRunSchema } from '../../domain/schemas.js';
import { runJavascript } from '../../infrastructure/sandbox.js';
import { checkRateKey } from '../rate-limit.js';
import { forbidden } from '../../domain/errors.js';

export async function miscRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true, service: 'orbitwork', time: new Date().toISOString() };
  });

  app.get('/api/models', async (request) => {
    requireUser(request, db);
    return {
      models: models(),
      demo: isDemoLlm(),
    };
  });

  app.post('/api/w/:workspaceId/sandbox/run', async (request) => {
    const ctx = requireWorkspace(request, db);
    if (ctx.workspace.settings.sandboxEnabled === false) throw forbidden('管理员已关闭工作区沙箱');
    checkRateKey(`sandbox:${ctx.user.id}`, 10, 60_000);
    const input = sandboxRunSchema.parse(request.body ?? {});
    const result = await runJavascript(input.code);
    return { result };
  });
}
