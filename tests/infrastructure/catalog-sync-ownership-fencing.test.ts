import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog sync ownership fencing', () => {
  it('keeps every later mutation fenced after the first ownership-loss detection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-ownership-fencing-'));
    roots.push(root);
    const path = join(root, 'catalog.db');
    let now = 1_000;
    const clock = { now: () => new Date(now) };
    const owner = track(
      new SqliteCatalogRepository(path, clock, {
        syncRunLease: {
          pid: 101,
          hostname: 'test-host',
          ownerTokenFactory: () => 'stale-owner-token',
          processAlive: () => true,
        },
      }),
    );
    const source = await owner.addSource({
      sourceKey: 'docs',
      displayName: 'Docs',
      baseUrl: 'https://example.com/docs/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const baseline = await owner.commitDocumentRevision(revision(source.id, 'baseline-hash'));
    const run = await owner.startCatalogSyncRun({
      sourceId: source.id,
      startedAt: new Date(now),
    });

    now = 2_000;
    const recovery = track(
      new SqliteCatalogRepository(path, clock, {
        syncRunLease: {
          pid: 202,
          hostname: 'test-host',
          ownerTokenFactory: () => 'recovery-owner-token',
          processAlive: (pid) => pid !== 101,
        },
      }),
    );
    recovery.close();
    repositories.splice(repositories.indexOf(recovery), 1);

    const observation = {
      syncRunId: run.id,
      aliases: [
        {
          url: 'https://example.com/docs/old-guide',
          aliasType: 'OLD_URL' as const,
        },
      ],
      events: [
        {
          eventType: 'CONTENT_HASH_CHANGED' as const,
          detailsJson: JSON.stringify({ staleOwner: true }),
        },
      ],
      currentVersionValidators: { etag: '"stale-owner"' },
    };

    now = 3_000;
    await expect(
      owner.commitDocumentRevision(revision(source.id, 'stale-hash-1'), observation),
    ).rejects.toThrow('CATALOG_SYNC_RUN_OWNERSHIP_LOST');

    now = 4_000;
    await expect(
      owner.commitDocumentRevision(revision(source.id, 'stale-hash-2'), observation),
    ).rejects.toThrow('CATALOG_SYNC_RUN_OWNERSHIP_LOST');

    await expect(owner.getCurrentDocumentVersion(baseline.document.id)).resolves.toMatchObject({
      id: baseline.version.id,
      contentHash: 'baseline-hash',
    });
    await expect(owner.listDocumentVersions(baseline.document.id)).resolves.toHaveLength(1);

    const database = new Database(path, { readonly: true });
    try {
      expect(rowCount(database, 'document_aliases', baseline.document.id)).toBe(0);
      expect(rowCount(database, 'staleness_events', baseline.document.id)).toBe(0);
    } finally {
      database.close();
    }
  });
});

function revision(sourceId: number, contentHash: string) {
  return {
    document: {
      publicId: 'doc-guide',
      sourceId,
      canonicalUrl: 'https://example.com/docs/guide',
      stableKey: 'guide',
      title: 'Guide',
      mimeType: 'text/html',
      language: 'en-US',
      status: 'ACTIVE' as const,
    },
    version: {
      contentHash,
      extractionMode: 'static' as const,
      contentType: 'text/html',
      metadataJson: JSON.stringify({ finalUrl: 'https://example.com/docs/guide' }),
    },
    sections: [
      {
        ordinal: 0,
        content: `Guide content ${contentHash}`,
        contentHash: `section-${contentHash}`,
        characterCount: `Guide content ${contentHash}`.length,
      },
    ],
  };
}

function rowCount(database: Database.Database, table: string, documentId: number): number {
  const row = database
    .prepare(`SELECT count(*) AS count FROM ${table} WHERE document_id = ?`)
    .get(documentId) as { readonly count: number } | undefined;
  return row?.count ?? 0;
}

function track(repository: SqliteCatalogRepository): SqliteCatalogRepository {
  repositories.push(repository);
  return repository;
}
