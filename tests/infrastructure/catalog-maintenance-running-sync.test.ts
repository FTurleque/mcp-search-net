import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteCatalogMaintenance,
} from '../../src/infrastructure/catalog/sqlite-catalog-maintenance.js';
import {
  SqliteCatalogRepository,
} from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog maintenance running sync retention', () => {
  it('never deletes or detaches an active sync run even with zero retention', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-maintenance-running-sync-'));
    roots.push(root);
    const path = join(root, 'catalog.db');
    const clock = { now: () => new Date('2026-08-15T00:00:00.000Z') };
    const repository = new SqliteCatalogRepository(path, clock);
    repositories.push(repository);

    const source = await repository.addSource({
      sourceKey: 'active-sync-docs',
      displayName: 'Active sync docs',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await repository.upsertDocument({
      publicId: 'active-sync-guide',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/guide',
      stableKey: 'guide',
      title: 'Active sync guide',
      mimeType: 'text/html',
      language: 'en',
      status: 'STALE',
    });
    const run = await repository.startCatalogSyncRun({
      sourceId: source.id,
      startedAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const writer = new Database(path);
    try {
      writer.pragma('foreign_keys = ON');
      writer
        .prepare(
          `INSERT INTO staleness_events (
            document_id, sync_run_id, event_type, observed_at, details_json
          ) VALUES (?, ?, 'HTTP_404', ?, '{}')`,
        )
        .run(document.id, run.id, Date.parse('2020-01-01T00:00:01.000Z'));
    } finally {
      writer.close();
    }

    const result = await new SqliteCatalogMaintenance(path, clock).run({
      keepSyncRuns: 0,
      maxSyncRunAgeDays: 0,
      staleLockMs: 60_000,
      vacuum: false,
    });

    expect(result.retention).toEqual({
      keepSyncRuns: 0,
      maxSyncRunAgeDays: 0,
      syncRunsBefore: 1,
      syncRunsDeleted: 0,
      syncRunsAfter: 1,
    });

    const reader = new Database(path, { readonly: true });
    try {
      expect(
        reader
          .prepare<[number], { status: string }>('SELECT status FROM sync_runs WHERE id = ?')
          .get(run.id),
      ).toEqual({ status: 'RUNNING' });
      expect(
        reader
          .prepare<[number], { sync_run_id: number | null }>(
            'SELECT sync_run_id FROM staleness_events WHERE document_id = ?',
          )
          .get(document.id),
      ).toEqual({ sync_run_id: run.id });
    } finally {
      reader.close();
    }

    await expect(
      repository.completeCatalogSyncRun(run.id, {
        completedAt: new Date('2026-08-15T00:00:01.000Z'),
        status: 'SUCCESS',
        documentsChecked: 1,
        documentsAdded: 0,
        documentsUpdated: 0,
        documentsUnchanged: 1,
        documentsFailed: 0,
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS' });
  });
});
