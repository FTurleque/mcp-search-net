import { describe, expect, it } from 'vitest';

import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import type { CatalogSource, CatalogSyncRun } from '../../src/domain/models/catalog.js';

const now = new Date('2026-08-15T12:00:00.000Z');

describe('SyncCatalogDocuments finalization failures', () => {
  it('rethrows the primary synchronization error and attaches the completion failure as its cause', async () => {
    const primaryError = new Error('rate-limit delay failed');
    const completionError = new Error('sync-run finalization failed');
    const source: CatalogSource = {
      id: 1,
      sourceKey: 'disabled-docs',
      displayName: 'Disabled docs',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };
    const runningRun: CatalogSyncRun = {
      id: 77,
      sourceId: source.id,
      runKind: 'EXECUTION',
      startedAt: now,
      status: 'RUNNING',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
    };
    const repository = {
      listSources: async () => [source],
      getDocumentByPublicId: async () => undefined,
      getCurrentDocumentVersion: async () => undefined,
      upsertDocument: async () => {
        throw new Error('unexpected upsert');
      },
      touchDocumentObservation: async () => {
        throw new Error('unexpected touch');
      },
      recordDocumentObservation: async () => {
        throw new Error('unexpected observation');
      },
      commitDocumentRevision: async () => {
        throw new Error('unexpected revision');
      },
      startCatalogSyncRun: async () => runningRun,
      completeCatalogSyncRun: async () => {
        throw completionError;
      },
    };
    const fetcher = {
      fetch: async () => {
        throw new Error('unexpected fetch');
      },
    };
    const sync = new SyncCatalogDocuments(
      repository,
      fetcher,
      { now: () => new Date(now) },
      async () => {
        throw primaryError;
      },
    );

    let caught: unknown;
    try {
      await sync.execute({
        sourceKey: source.sourceKey,
        documents: [document('one'), document('two')],
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
        maxRedirects: 1,
        rateLimitMs: 1,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(primaryError);
    expect(primaryError.cause).toBe(completionError);
  });
});

function document(stableKey: string) {
  return {
    sourceKey: 'disabled-docs',
    stableKey,
    title: stableKey,
    url: `https://example.test/${stableKey}`,
    language: 'en',
    mimeType: 'text/html',
    enabled: true,
  };
}
