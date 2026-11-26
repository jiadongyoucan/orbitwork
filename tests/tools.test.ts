import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTools } from '../server/application/agent-runtime.js';
import { openDb } from '../server/infrastructure/db.js';
import type { WorkspaceContext } from '../server/http/context.js';

const db = openDb(':memory:');
after(() => db.close());

function context(settings: Record<string, unknown>): WorkspaceContext {
  return {
    user: { id: 'u1', email: 'a@b.test', name: 'A', avatar: '', platformRole: 'user' },
    workspace: { id: 'w1', name: 'W', slug: 'w', ownerId: 'u1', plan: 'team', settings },
    role: 'owner',
  };
}

const names = (settings: Record<string, unknown>) => buildTools(db, context(settings), null).definitions.map((d) => d.function.name).sort();

test('agent tools are gated by the workspace network/file switches', () => {
  const all = names({});
  for (const tool of ['web_fetch', 'list_files', 'read_file', 'write_file', 'run_javascript']) {
    assert.ok(all.includes(tool), `expected ${tool} by default, got ${all.join(',')}`);
  }

  const offline = names({ networkEnabled: false });
  assert.equal(offline.includes('web_fetch'), false);

  const noFiles = names({ filesEnabled: false });
  for (const tool of ['list_files', 'read_file', 'write_file']) assert.equal(noFiles.includes(tool), false);

  const everythingOff = names({ networkEnabled: false, filesEnabled: false, sandboxEnabled: false });
  assert.deepEqual(everythingOff, []);
});
