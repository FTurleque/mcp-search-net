import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { loadCatalogMigrations } from '../../src/infrastructure/catalog/catalog-migrations.js';
import {
  CatalogMigrationRunner,
} from '../../src/infrastructure/catalog/catalog-migration-runner.js';
import {
  SqliteCatalogRepository,
} from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];
const clock = { now: () => new Date(10_000) };

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog sync execution concurrency guard', () => {
  it(
    'rejects a second execution for the same source while allowing another source and PLAN runs',
    async () => {
      const fixture = await createFixture();
      const contender = track(new SqliteCatalogRepository(fixture.path, clock));

      const sourceARun = await fixture.repository.startCatalogSyncRun({
        sourceId: fixture.sourceAId,
        startedAt: new Date(1_000),
      });

      await expect(
        contender.startCatalogSyncRun({
          sourceId: fixture.sourceAId,
          startedAt: new Date(2_000),
        }),
      ).rejects.toThrow('CATALOG_SYNC_RUN_ALREADY_RUNNING');

      const sourceBRun = await contender.startCatalogSyncRun({
        sourceId: fixture.sourceBId,
        startedAt: new Date(2_000),
      });
      const sourceAPlan = await contender.startCatalogSyncRun({
        sourceId: fixture.sourceAId,
        runKind: 'PLAN',
        startedAt: new Date(2_100),
      });

      await fixture.repository.completeCatalogSyncRun(sourceARun.id, completion(3_000));
      await contender.completeCatalogSyncRun(sourceBRun.id, completion(3_000));
      await contender.completeCatalogSyncRun(sourceAPlan.id, completion(3_000));

      await expect(
        contender.startCatalogSyncRun({
          sourceId: fixture.sourceAId,
          startedAt: new Date(4_000),
        }),
      ).resolves.toMatchObject({ status: 'RUNNING', sourceId: fixture.sourceAId });
    },
  );

  it('treats an unscoped execution as global and prevents overlap in both directions', async () => {
    const fixture = await createFixture();
    const contender = track(new SqliteCatalogRepository(fixture.path, clock));

    const globalRun = await fixture.repository.startCatalogSyncRun({ startedAt: new Date(1_000) });
    await expect(
      contender.startCatalogSyncRun({
        sourceId: fixture.sourceAId,
        startedAt: new Date(2_000),
      }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_ALREADY_RUNNING');
    await expect(
      contender.startCatalogSyncRun({ startedAt: new Date(2_000) }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_ALREADY_RUNNING');

    await fixture.repository.completeCatalogSyncRun(globalRun.id, completion(3_000));

    const scopedRun = await fixture.repository.startCatalogSyncRun({
      sourceId: fixture.sourceAId,
      startedAt: new Date(4_000),
    });
    await expect(
      contender.startCatalogSyncRun({ startedAt: new Date(5_000) }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_ALREADY_RUNNING');

    await fixture.repository.completeCatalogSyncRun(scopedRun.id, completion(6_000));
  });

  it('migrates legacy overlapping runs by fencing the older owner and keeps recovery possible', async () => {
    const root = createRoot('migration');
    const path = join(root, 'catalog.db');
    const database = new Database(path);
    const legacyMigrations = loadCatalogMigrations().filter((migration) => migration.version <= 13);
    new CatalogMigrationRunner(database, clock, legacyMigrations).apply();

    const sourceId = Number(
      database
        .prepare(
          `INSERT INTO catalog_sources (
             source_key, display_name, base_url, source_type, language,
             freshness_policy, sync_strategy, enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'legacy-source',
          'Legacy source',
          'https://example.test/legacy/',
          'documentation',
          'en',
          'manual',
          'manual',
          1,
          1_000,
          1_000,
        ).lastInsertRowid,
    );
    const insertRun = database.prepare(
      `INSERT INTO sync_runs (
         source_id, run_kind, started_at, completed_at, status,
         documents_checked, documents_added, documents_updated, documents_unchanged,
         documents_failed, error_summary, owner_token, owner_pid, owner_hostname, heartbeat_at
       ) VALUES (?, 'EXECUTION', ?, NULL, 'RUNNING', 0, 0, 0, 0, 0, NULL, ?, ?, ?, ?)`,
    );
    const olderId = Number(
      insertRun.run(sourceId, 1_000, 'legacy-owner-1', 901, 'test-host', 1_000).lastInsertRowid,
    );
    const newerId = Number(
      insertRun.run(sourceId, 2_000, 'legacy-owner-2', 902, 'test-host', 2_000).lastInsertRowid,
    );
    database.close();

    const observer = track(
      new SqliteCatalogRepository(path, clock, {
        syncRunLease: {
          pid: 999,
          hostname: 'test-host',
          ownerTokenFactory: () => 'observer-owner',
          processAlive: () => true,
        },
      }),
    );

    expect(readRun(path, olderId)).toMatchObject({
      status: 'FAILED',
      owner_token: null,
    });
    expect(readRun(path, olderId).error_summary).toContain('fenced during C014 migration');
    expect(readRun(path, newerId)).toMatchObject({
      status: 'RUNNING',
      owner_token: 'legacy-owner-2',
    });
    await expect(
      observer.startCatalogSyncRun({ sourceId, startedAt: new Date(3_000) }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_ALREADY_RUNNING');
    observer.close();
    repositories.splice(repositories.indexOf(observer), 1);

    const recovery = track(
      new SqliteCatalogRepository(
        path,
        { now: () => new Date(4_000) },
        {
          syncRunLease: {
            pid: 1_000,
            hostname: 'test-host',
            ownerTokenFactory: () => 'recovery-owner',
            processAlive: () => false,
          },
        },
      ),
    );

    expect(readRun(path, newerId).status).toBe('FAILED');
    await expect(
      recovery.startCatalogSyncRun({ sourceId, startedAt: new Date(5_000) }),
    ).resolves.toMatchObject({ status: 'RUNNING', sourceId });
  });
});

async function createFixture(): Promise<{
  readonly path: string;
  readonly repository: SqliteCatalogRepository;
  readonly sourceAId: number;
  readonly sourceBId: number;
}> {
  const root = createRoot('runtime');
  const path = join(root, 'catalog.db');
  const repository = track(new SqliteCatalogRepository(path, clock));
  const sourceA = await repository.addSource(sourceInput('source-a'));
  const sourceB = await repository.addSource(sourceInput('source-b'));
  return { path, repository, sourceAId: sourceA.id, sourceBId: sourceB.id };
}

function sourceInput(sourceKey: string) {
  return {
    sourceKey,
    displayName: sourceKey,
    baseUrl: `https://example.test/${sourceKey}/`,
    sourceType: 'documentation' as const,
    language: 'en',
    freshnessPolicy: 'manual' as const,
    syncStrategy: 'manual' as const,
    enabled: true,
  };
}

function completion(completedAt: number) {
  return {
    completedAt: new Date(completedAt),
    status: 'SUCCESS' as const,
    documentsChecked: 0,
    documentsAdded: 0,
    documentsUpdated: 0,
    documentsUnchanged: 0,
    documentsFailed: 0,
  };
}

function createRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `mcp-sync-guard-${label}-`));
  roots.push(root);
  return root;
}

function track(repository: SqliteCatalogRepository): SqliteCatalogRepository {
  repositories.push(repository);
  return repository;
}

function readRun(path: string, id: number): {
  readonly status: string;
  readonly error_summary: string | null;
  readonly owner_token: string | null;
} {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare<
        [number],
        {
          readonly status: string;
          readonly error_summary: string | null;
          readonly owner_token: string | null;
        }
      >('SELECT status, error_summary, owner_token FROM sync_runs WHERE id = ?')
      .get(id);
    if (row === undefined) throw new Error('SYNC_RUN_NOT_FOUND');
    return row;
  } finally {
    database.close();
  }
}
