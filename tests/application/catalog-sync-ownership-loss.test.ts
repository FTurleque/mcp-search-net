import { describe, expect, it, vi } from 'vitest';

import type { ContentFetcher } from '../../src/application/ports/content-fetcher.js';
import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import type { CatalogSource, CatalogSyncRun } from '../../src/domain/models/catalog.js';

const fixedClock = { now: () => new Date('2026-08-15T00:00:00.000Z') };

describe('catalog sync ownership loss', () => {
  it('aborts the run immediately instead of continuing with later documents', async () => {
    const ownershipLost = new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
    const repository = {
      listSources: vi.fn().mockResolvedValue([source()]),
      getDocumentByPublicId: vi.fn().mockResolvedValue(undefined),
      getCurrentDocumentVersion: vi.fn().mockResolvedValue(undefined),
      upsertDocument: vi.fn(),
      touchDocumentObservation: vi.fn(),
      recordDocumentObservation: vi.fn(),
      commitDocumentRevision: vi.fn().mockRejectedValue(ownershipLost),
      startCatalogSyncRun: vi.fn().mockResolvedValue(syncRun()),
      completeCatalogSyncRun: vi
        .fn()
        .mockRejectedValue(new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST')),
    } as unknown as ConstructorParameters<typeof SyncCatalogDocuments>[0];
    const fetcher = new CountingFetcher();
    const sync = new SyncCatalogDocuments(repository, fetcher, fixedClock);

    await expect(
      sync.execute({
        sourceKey: 'docs',
        documents: [document('first'), document('second')],
        timeoutMs: 1_000,
        maxResponseBytes: 100_000,
        maxRedirects: 3,
      }),
    ).rejects.toBe(ownershipLost);

    expect(fetcher.calls).toBe(1);
    expect(repository.commitDocumentRevision).toHaveBeenCalledTimes(1);
    expect(repository.completeCatalogSyncRun).toHaveBeenCalledTimes(1);
    expect(ownershipLost.cause).toBeInstanceOf(Error);
  });
});

class CountingFetcher implements ContentFetcher {
  public calls = 0;

  public fetch() {
    this.calls += 1;
    return Promise.resolve({
      requestedUrl: 'https://example.com/docs/page',
      finalUrl: 'https://example.com/docs/page',
      canonicalUrl: 'https://example.com/docs/page',
      title: 'Page',
      markdown: '# Page\n\nContent.',
      documentSections: [{ heading: 'Page', markdown: '# Page\n\nContent.' }],
      contentType: 'text/html',
      fetchedAt: '2026-08-15T00:00:00.000Z',
      extractionMode: 'static' as const,
      statusCode: 200,
      contentHash: 'page-hash',
      redirectChain: [],
      metadata: {},
      links: [],
    });
  }
}

function source(): CatalogSource {
  return {
    id: 1,
    sourceKey: 'docs',
    displayName: 'Docs',
    baseUrl: 'https://example.com/docs/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
    createdAt: new Date('2026-08-15T00:00:00.000Z'),
    updatedAt: new Date('2026-08-15T00:00:00.000Z'),
  };
}

function syncRun(): CatalogSyncRun {
  return {
    id: 1,
    sourceId: 1,
    runKind: 'EXECUTION',
    startedAt: new Date('2026-08-15T00:00:00.000Z'),
    status: 'RUNNING',
    documentsChecked: 0,
    documentsAdded: 0,
    documentsUpdated: 0,
    documentsUnchanged: 0,
    documentsFailed: 0,
  };
}

function document(stableKey: string) {
  return {
    sourceKey: 'docs',
    stableKey,
    title: stableKey,
    url: `https://example.com/docs/${stableKey}`,
    language: 'en',
    mimeType: 'text/html',
    enabled: true,
  } as const;
}
