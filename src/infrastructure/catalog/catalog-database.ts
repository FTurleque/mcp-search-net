import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { configureSqliteConnection, SQLITE_BUSY_TIMEOUT_MS } from '../sqlite-connection.js';

export function openCatalogDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { timeout: SQLITE_BUSY_TIMEOUT_MS });
  try {
    configureSqliteConnection(database);
    return database;
  } catch (error) {
    if (database.open) database.close();
    throw error;
  }
}
