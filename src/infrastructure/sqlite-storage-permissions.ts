import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function preparePrivateSqliteStorage(path: string): void {
  preparePrivateDirectory(dirname(path));
}

export function preparePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(path, 0o700);
}

export function hardenSqliteStoragePermissions(path: string): void {
  if (process.platform === 'win32') return;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    hardenPrivateFile(candidate);
  }
}

export function hardenPrivateFile(path: string): void {
  if (process.platform === 'win32' || !existsSync(path)) return;
  chmodSync(path, 0o600);
}
