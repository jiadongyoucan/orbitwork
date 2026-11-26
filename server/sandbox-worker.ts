import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { sandboxPermissionFlags } from './domain/sandbox-permissions.js';

/**
 * Isolated sandbox worker. It owns no database, no application secrets and no
 * internet route. Requests are serialized (concurrency 1); each snippet runs in
 * a child process under Node's permission model, with a hard timeout.
 */
const PORT = Number(process.env.SANDBOX_PORT ?? 8790);
const TOKEN = process.env.SANDBOX_TOKEN ?? 'dev-sandbox-token';
const TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS ?? 6000);
const QUEUE_DIR = process.env.SANDBOX_QUEUE_DIR ?? '';
const MAX_OUTPUT = 24_000;

if (!QUEUE_DIR && process.env.NODE_ENV === 'production' && TOKEN === 'dev-sandbox-token') {
  throw new Error('SANDBOX_TOKEN must be set when using HTTP sandbox mode in production');
}

type Result = { ok: boolean; stdout: string; stderr: string; durationMs: number; mode: string };

function runProcess(command: string, args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    const child = spawn(command, args, {
      cwd,
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT);
    child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)));
    child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)));
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message, durationMs: Date.now() - started, mode: 'node-permission' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        stdout,
        stderr: killed ? `${stderr}\n执行超时（${TIMEOUT_MS}ms），进程已终止。` : stderr,
        durationMs: Date.now() - started,
        mode: 'node-permission',
      });
    });
  });
}

async function execute(code: string): Promise<Result> {
  const baseDir = process.env.SANDBOX_TMP_DIR ?? '/tmp';
  const dir = await mkdtemp(join(baseDir, 'orbit-sbx-'));
  const realDir = await realpath(dir);
  const file = join(dir, 'main.mjs');
  await writeFile(file, `"use strict";\n${code}\n`, 'utf8');
  try {
    return await runProcess(
      process.execPath,
      [...sandboxPermissionFlags(dir, realDir), file],
      dir,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function startQueue() {
  const inbox = join(QUEUE_DIR, 'inbox');
  const outbox = join(QUEUE_DIR, 'outbox');
  await mkdir(inbox, { recursive: true });
  await mkdir(outbox, { recursive: true });
  const cleanup = async () => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [dir, suffix] of [[inbox, '.json'], [inbox, '.running'], [outbox, '.json'], [outbox, '.tmp']] as const) {
      for (const file of await readdir(dir).catch(() => [] as string[])) {
        if (!file.endsWith(suffix)) continue;
        const full = join(dir, file);
        const info = await stat(full).catch(() => null);
        if (info && info.mtimeMs < cutoff) await rm(full, { force: true }).catch(() => undefined);
      }
    }
  };
  await cleanup();
  setInterval(() => void cleanup(), 5 * 60_000);
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const pending = (await readdir(inbox)).filter((file) => file.endsWith('.json')).sort();
      if (pending.length) {
        const name = pending[0];
        const id = name.slice(0, -5);
        const running = join(inbox, `${id}.running`);
        await rename(join(inbox, name), running).catch(() => undefined);
        try {
          const job = JSON.parse(await readFile(running, 'utf8')) as { code?: string };
          const result = await execute(String(job.code ?? ''));
          const tmp = join(outbox, `${id}.tmp`);
          await writeFile(tmp, JSON.stringify(result), 'utf8');
          await rename(tmp, join(outbox, `${id}.json`));
        } catch (error) {
          console.error('[sandbox] job failed', (error as Error).message);
        } finally {
          await rm(running, { force: true }).catch(() => undefined);
        }
      }
    } catch (error) {
      console.error('[sandbox] queue error', (error as Error).message);
    } finally {
      busy = false;
    }
  }, 120);
  console.log('[sandbox] queue mode, serial execution');
}

if (QUEUE_DIR) {
  startQueue().catch((error) => {
    console.error('[sandbox] failed to start queue', error);
    process.exit(1);
  });
}

const server = createServer(async (req, res) => {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, mode: 'queue' });
  if (req.method !== 'POST' || req.url !== '/run') return reply(404, { error: 'not found' });
  if (QUEUE_DIR) return reply(503, { error: 'http execution disabled in queue mode' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: 'unauthorized' });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 30_000) return reply(413, { error: 'code too large' });
  }
  let code: string;
  try {
    code = String(JSON.parse(body).code ?? '');
  } catch {
    return reply(400, { error: 'invalid json' });
  }
  if (!code) return reply(400, { error: 'code required' });
  try {
    return reply(200, await execute(code));
  } catch (error) {
    return reply(500, { error: (error as Error).message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sandbox] health on 127.0.0.1:${PORT}`);
});
