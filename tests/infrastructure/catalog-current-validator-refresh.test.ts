import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog current-version validator refresh', () => {
  it('updates validators atomically while preserving a validator omitted by the 304 response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-validator-'));
    roots.push(root);
    let now = 1_000;
    const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), {
      now: () => new Date(now),
    });
    catalogs.push(catalog);
    const source = await catalog.addSource({
      sourceKey: 'docs',
      displayName: 'Docs',
      baseUrl: 'https://example.com/docs/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const revision = await catalog.commitDocumentRevision({
      document: {
        publicId: 'doc-guide',
        sourceId: source.id,
        canonicalUrl: 'https://example.com/docs/guide',
        stableKey: 'guide',
        title: 'Guide',
        mimeType: 'text/html',
        language: 'en-US',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'hash-v1',
        etag: '"v1"',
        lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
        extractionMode: 'static',
        contentType: 'text/html',
        metadataJson: JSON.stringify({ finalUrl: 'https://example.com/docs/guide' }),
      },
      sections: [
        {
          ordinal: 0,
          content: 'Stable guide content.',
          contentHash: 'section-v1',
          characterCount: 21,
        },
      ],
    });
    const run = await catalog.startCatalogSyncRun({ startedAt: new Date(now) });

    now = 2_000;
    await catalog.touchDocumentObservation(revision.document.id, {
      syncRunId: run.id,
      currentVersionValidators: { etag: '"v2"' },
    });

    await expect(catalog.getCurrentDocumentVersion(revision.document.id)).resolves.toMatchObject({
      id: revision.version.id,
      etag: '"v2"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      fetchedAt: new Date(2_000),
    });
  });
});
