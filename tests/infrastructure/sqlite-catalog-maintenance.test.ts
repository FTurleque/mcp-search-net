import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CatalogMaintenanceCheckpointError,
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
    const source = await fixture.repository.addSource({
      sourceKey: 'retention-docs',
      displayName: 'Retention docs',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await fixture.repository.upsertDocument({
      publicId: 'retention-guide',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/guide',
      stableKey: 'guide',
      title: 'Retention guide',
      mimeType: 'text/html',
      language: 'en',
      status: 'STALE',
    });
    closeFixtureRepository(fixture.repository);
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
    database
      .prepare(
        `INSERT INTO staleness_events (
          document_id, sync_run_id, event_type, observed_at, details_json
        ) VALUES (?, ?, 'HTTP_404', ?, '{}')`,
      )
      .run(document.id, 1, 2_000);
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
    const retained = new Database(fixture.path, { readonly: true });
    expect(retained.prepare('SELECT sync_run_id FROM staleness_events').get()).toEqual({
      sync_run_id: null,
    });
    retained.close();
  });

  it('fails rather than reporting success when an active reader blocks the TRUNCATE checkpoint', async () => {
    const fixture = createFixture();
    closeFixtureRepository(fixture.repository);
    const writer = new Database(fixture.path);
    const reader = new Database(fixture.path);
    writer.pragma('journal_mode = WAL');
    reader.pragma('journal_mode = WAL');
    const insert = writer.prepare(
      `INSERT INTO sync_runs (
        id, source_id, started_at, completed_at, status,
        documents_checked, documents_added, documents_updated,
        documents_unchanged, documents_failed, error_summary
      ) VALUES (?, NULL, ?, ?, 'SUCCESS', 0, 0, 0, 0, 0, NULL)`,
    );

    try {
      insert.run(1, fixture.clock.now().getTime(), fixture.clock.now().getTime());
      reader.exec('BEGIN');
      expect(
        reader.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sync_runs').get()
          ?.count,
      ).toBe(1);
      insert.run(2, fixture.clock.now().getTime(), fixture.clock.now().getTime());

      await expect(
        new SqliteCatalogMaintenance(fixture.path, fixture.clock).run({
          keepSyncRuns: 100,
          maxSyncRunAgeDays: 90,
          staleLockMs: 60_000,
          vacuum: false,
        }),
      ).rejects.toBeInstanceOf(CatalogMaintenanceCheckpointError);
      expect(existsSync(`${fixture.path}.maintenance.lock`)).toBe(false);
      expect(existsSync(`${fixture.path}.maintenance.lock.heartbeat`)).toBe(false);
    } finally {
      if (reader.inTransaction) reader.exec('ROLLBACK');
      reader.close();
      writer.close();
    }
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

function closeFixtureRepository(repository: SqliteCatalogRepository): void {
  repository.close();
  repositories.splice(repositories.indexOf(repository), 1);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-maintenance-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const repository = new SqliteCatalogRepository(path, clock);
  repositories.push(repository);
  return { clock, path, repository };
}
