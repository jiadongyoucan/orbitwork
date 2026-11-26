import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandboxPermissionFlags } from '../server/domain/sandbox-permissions.js';

/**
 * Regression for the sandbox positioning (P1-4-A): the worker relies on Node's
 * permission model for filesystem isolation and on Docker network:none for
 * egress. This asserts the filesystem half with the same flags the worker uses.
 */
test('sandbox: node permission flags block reads outside /tmp and all writes', () => {
  const dir = mkdtempSync(join('/tmp', 'orbit-perm-'));
  try {
    const script = join(dir, 'main.mjs');
    writeFileSync(script, [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "try { readFileSync('/etc/passwd'); console.log('READ_OK'); } catch { console.log('READ_BLOCKED'); }",
      "try { writeFileSync('escape.txt', 'x'); console.log('WRITE_OK'); } catch { console.log('WRITE_BLOCKED'); }",
    ].join('\n'));

    const flags = sandboxPermissionFlags(dir, dir);
    assert.ok(flags.includes('--permission'));
    assert.equal(flags.some((flag) => flag.startsWith('--allow-fs-write')), false, 'worker must not grant writes');
    assert.equal(flags.filter((flag) => flag.startsWith('--allow-fs-read')).length, 4, 'read allowlist stays explicit');

    const result = spawnSync(process.execPath, [...flags, script], { encoding: 'utf8', timeout: 10_000, cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /READ_BLOCKED/);
    assert.match(result.stdout, /WRITE_BLOCKED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
