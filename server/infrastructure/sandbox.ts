import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../domain/errors.js';

export type SandboxResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  mode: string;
};

/**
 * Production path: a file-queue consumed by a `network_mode: none` sandbox
 * container. No HTTP surface and no shared network between app and sandbox.
 * Development path: loopback-only HTTP worker.
 */
async function runViaQueue(code: string): Promise<SandboxResult> {
  const root = config.sandbox.queueDir;
  const inbox = join(root, 'inbox');
  const outbox = join(root, 'outbox');
  await mkdir(inbox, { recursive: true });
  await mkdir(outbox, { recursive: true });
  const id = randomUUID();
  const temp = join(inbox, `${id}.tmp`);
  await writeFile(temp, JSON.stringify({ code, createdAt: Date.now() }), 'utf8');
  await rename(temp, join(inbox, `${id}.json`));
  const deadline = Date.now() + config.sandbox.timeoutMs + 3000;
  try {
    while (Date.now() < deadline) {
      try {
        const text = await readFile(join(outbox, `${id}.json`), 'utf8');
        await rm(join(outbox, `${id}.json`), { force: true });
        return { ...(JSON.parse(text) as SandboxResult), mode: 'queue' };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new AppError(503, 'SANDBOX_TIMEOUT', '沙箱执行超时，请稍后重试');
  } finally {
    await rm(join(inbox, `${id}.json`), { force: true }).catch(() => undefined);
  }
}

async function runViaHttp(code: string): Promise<SandboxResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.sandbox.timeoutMs + 1500);
  try {
    const response = await fetch(`${config.sandbox.url}/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.sandbox.token}`,
      },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    if (response.status === 429) throw new AppError(429, 'SANDBOX_BUSY', '沙箱正忙，请稍后重试');
    if (!response.ok) throw new AppError(503, 'SANDBOX_UNAVAILABLE', '沙箱服务暂时不可用');
    return (await response.json()) as SandboxResult;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'SANDBOX_UNAVAILABLE', '沙箱服务未启动或不可达');
  } finally {
    clearTimeout(timer);
  }
}

export async function runJavascript(code: string): Promise<SandboxResult> {
  if (code.length > 20_000) throw new AppError(400, 'CODE_TOO_LARGE', '代码长度不能超过 20KB');
  return config.sandbox.queueDir ? runViaQueue(code) : runViaHttp(code);
}
