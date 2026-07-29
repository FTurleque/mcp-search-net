import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CatalogMaintenanceLockError,
  SqliteCatalogMaintenance,
} from '../../src/infrastructure/catalog/sqlite-catalog-maintenance.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogMaintenance', () => {
  it('runs retention, WAL checkpoint and releases its lease files', async () => {
    const fixture = createFixture();
    fixture.repository.close();
    repositories.splice(repositories.indexOf(fixture.repository), 1);
    const database = new Database(fixture.path);
    const insert = database.prepare(
      `INSERT INTO sync_runs (
        id, source_id, started_at, completed_at, status,
        documents_checked, documents_added, documents_updated,
        documents_unchanged, documents_failed, error_summary
      ) VALUES (?, NULL, ?, ?, 'SUCCESS', 0, 0, 0, 0, 0, NULL)`,
    );
    insert.run(1, 1_000, 2_000);
    insert.run(2, 2_000, 3_000);
    insert.run(3, 3_000, 4_000);
    database.close();

    const result = await new SqliteCatalogMaintenance(fixture.path, fixture.clock).run({
      keepSyncRuns: 1,
      maxSyncRunAgeDays: 30,
      staleLockMs: 60_000,
      vacuum: false,
    });

    expect(result).toMatchObject({
      status: 'maintained',
      retention: { syncRunsBefore: 3, syncRunsDeleted: 2, syncRunsAfter: 1 },
      sqlite: { analyzed: true, optimized: true, walCheckpointed: true, vacuumed: false },
    });
    expect(existsSync(`${fixture.path}.maintenance.lock`)).toBe(false);
    expect(existsSync(`${fixture.path}.maintenance.lock.heartbeat`)).toBe(false);
  });

  it('maps a live interprocess lease conflict to the maintenance public error', async () => {
    const fixture = createFixture();
    const lockPath = `${fixture.path}.maintenance.lock`;
    const lease = new FileLeaseLock(lockPath, {
      staleAfterMs: 60_000,
      clock: fixture.clock,
    }).acquire();
    try {
      await expect(
        new SqliteCatalogMaintenance(fixture.path, fixture.clock).run({
          keepSyncRuns: 100,
          maxSyncRunAgeDays: 90,
          staleLockMs: 60_000,
          vacuum: false,
        }),
      ).rejects.toBeInstanceOf(CatalogMaintenanceLockError);
    } finally {
      lease.release();
    }
  });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-maintenance-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const repository = new SqliteCatalogRepository(path, clock);
  repositories.push(repository);
  return { clock, path, repository };
}
