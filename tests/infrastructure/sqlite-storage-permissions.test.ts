import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { SqliteCatalogBackup } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const closeables: { close(): void }[] = [];
const clock = { now: () => new Date('2026-08-15T12:00:00.000Z') };

afterEach(() => {
  closeables
    .splice(0)
    .reverse()
    .forEach((closeable) => closeable.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('persistent SQLite storage permissions', () => {
  it('hardens cache, catalog, sidecars and catalog backups on POSIX', async (context) => {
    if (process.platform === 'win32') context.skip();

    const root = mkdtempSync(join(tmpdir(), 'mcp-sqlite-permissions-'));
    roots.push(root);

    const cachePath = join(root, 'cache-private', 'cache.sqlite');
    const cache = new SqliteCacheRepository(cachePath, clock, 100, 1_048_576, 60_000);
    closeables.push(cache);
    await cache.setSearch('key', { value: 'private cache content' }, 60_000);
    assertPrivateSqlite(cachePath);
    expect(permissionBits(dirname(cachePath)) & 0o077).toBe(0);

    const catalogPath = join(root, 'catalog-private', 'catalog.db');
    const catalog = new SqliteCatalogRepository(catalogPath, clock);
    closeables.push(catalog);
    await catalog.addSource({
      sourceKey: 'permission-test',
      displayName: 'Permission test',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    assertPrivateSqlite(catalogPath);
    expect(permissionBits(dirname(catalogPath)) & 0o077).toBe(0);

    const backup = await new SqliteCatalogBackup(catalogPath, clock).run('private-snapshot.db');
    expect(permissionBits(dirname(backup.destinationPath)) & 0o077).toBe(0);
    expect(permissionBits(backup.destinationPath)).toBe(0o600);
  });
});

function assertPrivateSqlite(path: string): void {
  expect(permissionBits(path)).toBe(0o600);
  for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
    if (existsSync(sidecar)) expect(permissionBits(sidecar)).toBe(0o600);
  }
}

function permissionBits(path: string): number {
  return statSync(path).mode & 0o777;
}
