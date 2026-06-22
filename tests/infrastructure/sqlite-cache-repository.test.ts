import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CacheRepository } from '../../src/application/ports/cache-repository.js';
import { SafeCacheRepository } from '../../src/infrastructure/cache/safe-cache-repository.js';
import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { StructuredLogger } from '../../src/infrastructure/logging/structured-logger.js';

const roots: string[] = [];
const caches: SqliteCacheRepository[] = [];
afterEach(() => {
  caches.splice(0).forEach((cache) => cache.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCacheRepository', () => {
  it('migrates, stores typed validators, and exposes fresh and stale records', async () => {
    const fixture = createRepository();
    await fixture.cache.setContent('doc', { markdown: 'value' }, 1_000, {
      etag: '"v1"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      contentHash: 'abc',
    });
    await expect(fixture.cache.getContent<{ markdown: string }>('doc')).resolves.toMatchObject({
      value: { markdown: 'value' },
      stale: false,
      etag: '"v1"',
      contentHash: 'abc',
    });
    fixture.setNow(2_000);
    await expect(fixture.cache.getContent('doc')).resolves.toBeUndefined();
    await expect(fixture.cache.getContent('doc', { allowStale: true })).resolves.toMatchObject({
      stale: true,
    });
  });

  it('removes corrupt payloads without exposing SQLite details', async () => {
    const fixture = createRepository();
    await fixture.cache.setSearch('bad', { ok: true }, 10_000);
    const database = new Database(fixture.path);
    database.prepare("UPDATE search_cache SET payload = '{' WHERE cache_key = 'bad'").run();
    database.close();
    await expect(fixture.cache.getSearch('bad', { allowStale: true })).resolves.toBeUndefined();
  });

  it('prunes overflow and entries beyond stale retention while tolerating concurrent writes', async () => {
    const fixture = createRepository(10, 1_000);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        fixture.cache.setSearch(String(index), { index }, 100),
      ),
    );
    fixture.setNow(2_000);
    expect(await fixture.cache.deleteExpired()).toBeGreaterThan(0);
    const database = new Database(fixture.path, { readonly: true });
    expect(
      (database.prepare('SELECT count(*) AS count FROM search_cache').get() as { count: number })
        .count,
    ).toBe(0);
    expect(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('search_cache', 'content_cache', 'schema_migrations')",
          )
          .get() as { count: number }
      ).count,
    ).toBe(3);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables.map(({ name }) => name)).toEqual([
      'content_cache',
      'schema_migrations',
      'search_cache',
    ]);
    const versions = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as { version: number }[];
    expect(versions.map(({ version }) => version)).toEqual([1, 2, 3, 4]);
    database.close();
  });

  it('continues with cache disabled after an operational failure', async () => {
    const failing: CacheRepository = {
      enabled: true,
      async getSearch() {
        throw new Error('SQLITE path secret');
      },
      async setSearch() {},
      async getContent() {
        return undefined;
      },
      async setContent() {},
      async deleteExpired() {
        return 0;
      },
      close() {},
    };
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cache = new SafeCacheRepository(failing, true, new StructuredLogger('error'));
    await expect(cache.getSearch('key')).resolves.toBeUndefined();
    expect(cache.enabled).toBe(false);
    expect(String(write.mock.calls[0]?.[0])).not.toContain('path secret');
    write.mockRestore();
  });
});

function createRepository(maxEntries = 100, staleRetentionMs = 10_000) {
  const root = mkdtempSync(join(tmpdir(), 'mcp-cache-'));
  roots.push(root);
  const path = join(root, 'cache.sqlite');
  let now = 0;
  const cache = new SqliteCacheRepository(
    path,
    { now: () => new Date(now) },
    maxEntries,
    staleRetentionMs,
  );
  caches.push(cache);
  return {
    cache,
    path,
    setNow: (value: number) => {
      now = value;
    },
  };
}
