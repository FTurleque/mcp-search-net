import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import Database from 'better-sqlite3';

const [databasePath, readyPath, sourceIdText, holdMsText] = process.argv.slice(2);
if (
  databasePath === undefined ||
  readyPath === undefined ||
  sourceIdText === undefined ||
  holdMsText === undefined
) {
  throw new Error('Usage: hold-catalog-write-lock <db> <ready> <source-id> <hold-ms>');
}

const sourceId = Number(sourceIdText);
const holdMs = Number(holdMsText);
if (!Number.isSafeInteger(sourceId) || sourceId <= 0) throw new Error('source-id must be positive');
if (!Number.isSafeInteger(holdMs) || holdMs < 0) throw new Error('hold-ms must be non-negative');

const database = new Database(databasePath, { timeout: 5_000 });
database.pragma('busy_timeout = 5000');

database.exec('BEGIN IMMEDIATE');
try {
  const result = database
    .prepare('UPDATE catalog_sources SET updated_at = updated_at + 1 WHERE id = ?')
    .run(sourceId);
  if (result.changes !== 1) throw new Error('CATALOG_SOURCE_NOT_FOUND');
  writeFileSync(readyPath, 'ready\n', 'utf8');
  await delay(holdMs);
  database.exec('COMMIT');
} catch (error) {
  if (database.inTransaction) database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}
