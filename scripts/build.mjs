import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist/public');
const dev = process.argv.includes('--watch');
const withServer = !process.argv.includes('--client-only');

function buildClient() {
  mkdirSync(outDir, { recursive: true });
  const result = buildSync({
    entryPoints: { app: resolve(root, 'src/main.tsx') },
    outdir: resolve(outDir, 'assets'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
    loader: { '.svg': 'dataurl', '.png': 'dataurl' },
    logLevel: 'warning',
  });
  if (result.errors.length) throw new Error('client build failed');
  const template = readFileSync(resolve(root, 'index.html'), 'utf8');
  const html = template
    .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="/assets/app.css" />\n    <script type="module" src="/assets/app.js"></script>');
  writeFileSync(resolve(outDir, 'index.html'), html);
  console.log(`[build] client -> dist/public (${dev ? 'dev' : 'production'})`);
}

function buildServer() {
  if (!withServer) return;
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  for (const [entry, out] of [['server/index.ts', 'server.js'], ['server/sandbox-worker.ts', 'sandbox-worker.js'], ['server/backup.ts', 'backup.js']]) {
    buildSync({
      entryPoints: [resolve(root, entry)],
      outfile: resolve(root, 'dist', out),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['node22'],
      packages: 'external',
      sourcemap: false,
      logLevel: 'warning',
    });
  }
  console.log('[build] server -> dist/server.js, dist/sandbox-worker.js, dist/backup.js');
}

function buildAll() {
  const start = Date.now();
  buildClient();
  buildServer();
  console.log(`[build] done in ${Date.now() - start}ms`);
}

try {
  buildAll();
} catch (error) {
  console.error('[build] failed:', error.message);
  if (!dev) process.exit(1);
}

if (dev) {
  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { buildClient(); } catch (error) { console.error('[build] client failed:', error.message); }
    }, 140);
  };
  watch(resolve(root, 'src'), { recursive: true }, rebuild);
  watch(resolve(root, 'index.html'), rebuild);
  console.log('[build] watching src/ and index.html');
}
