import test from 'node:test';
import assert from 'node:assert/strict';
import { isImageMime, isTextLike, mimeFromName, normalizeFileName } from '../server/domain/files.js';
import { decodeEntities, extractTitle, htmlToText, prettyJson } from '../server/domain/web-text.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

test('file names: strip directories, control chars and platform-hostile characters', () => {
  assert.equal(normalizeFileName('notes.md'), 'notes.md');
  assert.equal(normalizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(normalizeFileName('..\\..\\windows\\win.ini'), 'win.ini');
  assert.equal(normalizeFileName('a\u0000b.txt'), 'ab.txt');
  assert.equal(normalizeFileName('re:port?.csv'), 're_port_.csv');
  assert.equal(normalizeFileName('中文 报告.md'), '中文 报告.md');
  assert.equal(normalizeFileName('   '), null);
  assert.equal(normalizeFileName('...'), null);
  assert.equal(normalizeFileName('x'.repeat(121)), null);
});

test('file kinds: text detection and mime inference', () => {
  assert.equal(isTextLike('a.md'), true);
  assert.equal(isTextLike('a.MD'), true);
  assert.equal(isTextLike('a.png'), false);
  assert.equal(isTextLike('blob', 'text/plain'), true);
  assert.equal(isTextLike('data', 'application/json'), true);
  assert.equal(isTextLike('archive.bin', 'application/zip'), false);
  assert.equal(isImageMime('image/png'), true);
  assert.equal(isImageMime('image/svg+xml'), false);
  assert.equal(mimeFromName('report.md'), 'text/markdown');
  assert.equal(mimeFromName('photo.webp'), 'image/webp');
  assert.equal(mimeFromName('unknown.zzz'), 'application/octet-stream');
});

test('html: entities, title and readable text', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;q&#x27; &nbsp;'), "a & b <c> 'q'  ");
  assert.equal(extractTitle('<html><head><title>Orbit &amp; Work</title></head></html>'), 'Orbit & Work');
  const html = '<html><head><title>T</title><style>.x{}</style></head><body><h1>Hello</h1><p>A &amp; B</p><script>alert(1)</script><ul><li>one</li><li>two</li></ul></body></html>';
  const text = htmlToText(html, 10_000);
  assert.match(text, /Hello/);
  assert.match(text, /A & B/);
  assert.match(text, /- one/);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /\.x\{/);
  assert.match(htmlToText('<p>' + 'x'.repeat(50) + '</p>', 10), /已截断/);
  assert.match(prettyJson('{"a":1}'), /"a": 1/);
  assert.equal(prettyJson('not json'), 'not json');
});

test('SSRF: web path cannot be unlocked by env flag and blocks v6/nat64 escapes', async () => {
  const { assertSafeUrl } = await import('../server/infrastructure/connectors.js');
  const { config } = await import('../server/config.js');
  const original = config.allowPrivateConnectors;
  config.allowPrivateConnectors = true;
  try {
    const blocked = [
      'http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
      'http://[64:ff9b::a9fe:a9fe]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[fec0::1]/',
      'http://[2002:7f00:1::]/', 'http://[2001:0:0:0:0:0:0:1]/', 'http://169.254.169.254/',
      'http://10.0.0.1/', 'http://192.0.0.8/', 'http://198.18.0.1/', 'http://198.51.100.7/',
      'http://203.0.113.9/', 'http://240.0.0.1/', 'http://100.64.0.1/', 'http://0.0.0.0/',
    ];
    for (const url of blocked) {
      await assert.rejects(
        () => assertSafeUrl(url, { allowPrivate: false }),
        (error: any) => error?.code === 'PRIVATE_URL',
        url,
      );
    }
    const publicIp = await assertSafeUrl('https://1.1.1.1/', { allowPrivate: false });
    assert.equal(publicIp.hostname, '1.1.1.1');
    const optedIn = await assertSafeUrl('http://127.0.0.1/', { allowPrivate: true });
    assert.equal(optedIn.hostname, '127.0.0.1');
  } finally {
    config.allowPrivateConnectors = original;
  }
});

test('SSRF: a redirected hop is revalidated', async () => {
  const { fetchAsText } = await import('../server/infrastructure/web.js');
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } })) as unknown as typeof fetch;
  try {
    await assert.rejects(() => fetchAsText('https://1.1.1.1/'), (error: any) => error?.code === 'PRIVATE_URL');
  } finally {
    globalThis.fetch = original;
  }
});

test('files: reads stop at the window instead of suggesting an unreachable offset', async () => {
  const { readText, storagePathFor } = await import('../server/infrastructure/files.js');
  const { config } = await import('../server/config.js');
  const original = config.files.dir;
  const dir = join(tmpdir(), `orbit-read-${Date.now()}`);
  config.files.dir = dir;
  try {
    const workspaceId = 'ws-test';
    const id = 'file-test';
    const path = storagePathFor(workspaceId, id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'a'.repeat(config.files.readBytes + 5000));
    const row = { id, workspace_id: workspaceId, name: 'big.txt', mime: 'text/plain', size: config.files.readBytes + 5000 } as any;
    const atEnd = readText(row, config.files.readBytes, 7000);
    assert.equal(atEnd.text.length, 0);
    assert.equal(atEnd.truncated, false);
    assert.equal(atEnd.windowLimited, true);
    const first = readText(row, 0, 10);
    assert.equal(first.text.length, 10);
    assert.equal(first.truncated, true);
  } finally {
    config.files.dir = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
