import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export function openCatalogDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { timeout: SQLITE_BUSY_TIMEOUT_MS });
  try {
    database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('foreign_keys = ON');
    return database;
  } catch (error) {
    if (database.open) database.close();
    throw error;
  }
}
