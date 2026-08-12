import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';

describe('SqliteCacheRepository migration integrity', () => {
  it('stores migration names and checksums and rejects drift on reopen', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-cache-migration-'));
    const path = join(root, 'cache.sqlite');
    try {
      const first = new SqliteCacheRepository(
        path,
        { now: () => new Date(0) },
        100,
        1_000_000,
        10_000,
      );
      first.close();

      const database = new Database(path);
      const rows = database
        .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; name: string | null; checksum: string | null }[];
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.name?.startsWith(`V${String(row.version).padStart(3, '0')}__`)))
        .toBe(true);
      expect(rows.every((row) => /^[a-f0-9]{64}$/u.test(row.checksum ?? ''))).toBe(true);

      database
        .prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 2")
        .run();
      database.close();

      expect(
        () =>
          new SqliteCacheRepository(
            path,
            { now: () => new Date(0) },
            100,
            1_000_000,
            10_000,
          ),
      ).toThrow('CACHE_MIGRATION_CHECKSUM_MISMATCH:2:V002__create_search_cache.sql');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
