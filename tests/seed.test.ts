import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/infrastructure/db.js';
import { seedDatabase } from '../server/seed.js';

test('seeding is idempotent and does not republish assets suspended by moderation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-seed-test-'));
  try {
    const db = openDb(join(dir, 'seed.db'));
    await seedDatabase(db, { demo: true, quiet: true });
    const before = (db.prepare("SELECT COUNT(*) as n FROM assets WHERE status = 'published' AND visibility = 'public'").get() as { n: number }).n;
    assert.ok(before >= 9);
    db.prepare("UPDATE assets SET status = 'suspended' WHERE status = 'published' AND visibility = 'public'").run();
    await seedDatabase(db, { demo: true, quiet: true });
    const after = (db.prepare("SELECT COUNT(*) as n FROM assets WHERE status = 'published' AND visibility = 'public'").get() as { n: number }).n;
    assert.equal(after, 0, 'suspended marketplace assets must stay suspended after a restart');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
