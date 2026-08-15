import process from 'node:process';

import Database from 'better-sqlite3';

import {
  configureSqliteConnection,
  SQLITE_BUSY_TIMEOUT_MS,
} from '../../src/infrastructure/sqlite-connection.js';

const [path, documentIdText, versionIdText, holdMsText] = process.argv.slice(2);
if (path === undefined || documentIdText === undefined || versionIdText === undefined) {
  throw new Error('Missing catalog promotion fixture arguments');
}

const documentId = Number(documentIdText);
const versionId = Number(versionIdText);
const holdMs = Number(holdMsText ?? '250');
if (
  !Number.isSafeInteger(documentId) ||
  documentId <= 0 ||
  !Number.isSafeInteger(versionId) ||
  versionId <= 0 ||
  !Number.isSafeInteger(holdMs) ||
  holdMs < 0
) {
  throw new Error('Invalid catalog promotion fixture arguments');
}

const database = new Database(path, { timeout: SQLITE_BUSY_TIMEOUT_MS });
configureSqliteConnection(database);

try {
  database.exec('BEGIN IMMEDIATE');
  database.prepare('UPDATE document_versions SET is_current = 0 WHERE document_id = ?').run(documentId);
  database
    .prepare('UPDATE document_versions SET is_current = 1 WHERE id = ? AND document_id = ?')
    .run(versionId, documentId);
  database
    .prepare('UPDATE documents SET current_version_id = ? WHERE id = ?')
    .run(versionId, documentId);
  process.send?.({ type: 'ready' });

  setTimeout(() => {
    try {
      database.exec('COMMIT');
      database.close();
      process.exit(0);
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK');
      database.close();
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }, holdMs);
} catch (error) {
  if (database.inTransaction) database.exec('ROLLBACK');
  database.close();
  throw error;
}
