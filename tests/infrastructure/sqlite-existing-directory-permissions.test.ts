import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { SqliteSearchHistoryRepository } from '../../src/infrastructure/history/sqlite-search-history-repository.js';

const roots: string[] = [];
const closeables: { close(): void }[] = [];
const clock = { now: () => new Date('2026-08-16T18:00:00.000Z') };

afterEach(() => {
  closeables
    .splice(0)
    .reverse()
    .forEach((closeable) => closeable.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('pre-existing SQLite storage directory permissions', () => {
  it('re-hardens permissive cache, catalog and history directories to 0700 on POSIX', (context) => {
    if (process.platform === 'win32') context.skip();

    const root = mkdtempSync(join(tmpdir(), 'mcp-existing-sqlite-permissions-'));
    roots.push(root);
    const cacheDirectory = join(root, 'cache');
    const catalogDirectory = join(root, 'catalog');
    const historyDirectory = join(root, 'history');
    for (const directory of [cacheDirectory, catalogDirectory, historyDirectory]) {
      mkdirSync(directory, { recursive: true });
      chmodSync(directory, 0o755);
      expect(permissionBits(directory)).toBe(0o755);
    }

    const cache = new SqliteCacheRepository(
      join(cacheDirectory, 'cache.sqlite'),
      clock,
      100,
      1_048_576,
      60_000,
    );
    closeables.push(cache);
    const catalog = new SqliteCatalogRepository(join(catalogDirectory, 'catalog.db'), clock);
    closeables.push(catalog);
    const history = new SqliteSearchHistoryRepository(
      join(historyDirectory, 'history.sqlite'),
      clock,
      90,
      1_000,
    );
    closeables.push(history);

    expect(permissionBits(cacheDirectory)).toBe(0o700);
    expect(permissionBits(catalogDirectory)).toBe(0o700);
    expect(permissionBits(historyDirectory)).toBe(0o700);
  });
});

function permissionBits(path: string): number {
  return statSync(path).mode & 0o777;
}
