import 'dotenv/config';
import { openDb } from './infrastructure/db.js';
import { seedDatabase } from './seed.js';

const db = openDb();
await seedDatabase(db);
db.close();
console.log('[seed] complete');
