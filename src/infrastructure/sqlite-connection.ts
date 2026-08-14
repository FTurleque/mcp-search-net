import type Database from 'better-sqlite3';

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

const WAL_BOOTSTRAP_RETRY_MS = 25;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

export function configureSqliteConnection(database: Database.Database): void {
  database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

  const deadline = Date.now() + SQLITE_BUSY_TIMEOUT_MS;
  for (;;) {
    try {
      database.pragma('journal_mode = WAL');
      break;
    } catch (error) {
      if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
      Atomics.wait(waitBuffer, 0, 0, WAL_BOOTSTRAP_RETRY_MS);
    }
  }

  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = ON');
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}
