import { describe, expect, it } from 'vitest';

import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import type {
  CatalogDocument,
  CatalogDocumentObservationInput,
  CatalogDocumentRevision,
  CatalogSource,
  CatalogSyncRun,
  DocumentVersion,
} from '../../src/domain/models/catalog.js';

const now = new Date('2026-08-12T10:00:00.000Z');
const documentUrl = 'https://example.com/docs/guide';

const source: CatalogSource = {
  id: 1,
  sourceKey: 'docs',
  displayName: 'Docs',
  baseUrl: 'https://example.com/docs/',
  sourceType: 'documentation',
  language: 'en-US',
  freshnessPolicy: 'manual',
  syncStrategy: 'manual',
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const document: CatalogDocument = {
  id: 10,
  publicId: 'doc_guide',
  sourceId: source.id,
  canonicalUrl: documentUrl,
  stableKey: 'guide',
  title: 'Guide',
  mimeType: 'text/html',
  language: 'en-US',
  status: 'ACTIVE',
  currentVersionId: 20,
  firstSeenAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

const version: DocumentVersion = {
  id: 20,
  documentId: document.id,
  contentHash: 'hash-v1',
  etag: '"v1"',
  lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
  fetchedAt: now,
  isCurrent: true,
  extractionMode: 'static',
  contentType: 'text/html',
  metadataJson: JSON.stringify({ finalUrl: documentUrl }),
};

describe('SyncCatalogDocuments 304 validator refresh', () => {
  it('binds validators to the stored representation URL and persists fresh 304 validators', async () => {
    let observation: CatalogDocumentObservationInput | undefined;
    let fetchContext: unknown;
    const repository = {
      async listSources() {
        return [source];
      },
      async getDocumentByPublicId() {
        return document;
      },
      async getCurrentDocumentVersion() {
        return version;
      },
      async upsertDocument() {
        throw new Error('Unexpected document upsert');
      },
      async touchDocumentObservation(_documentId: number, value?: CatalogDocumentObservationInput) {
        observation = value;
        return document;
      },
      async recordDocumentObservation() {},
      async commitDocumentRevision(): Promise<CatalogDocumentRevision> {
        throw new Error('Unexpected revision');
      },
      async startCatalogSyncRun(): Promise<CatalogSyncRun> {
        return {
          id: 1,
          runKind: 'EXECUTION',
          startedAt: now,
          status: 'RUNNING',
          documentsChecked: 0,
          documentsAdded: 0,
          documentsUpdated: 0,
          documentsUnchanged: 0,
          documentsFailed: 0,
        };
      },
      async completeCatalogSyncRun(
        _syncRunId: number,
        input: {
          readonly completedAt: Date;
          readonly status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
          readonly documentsChecked: number;
          readonly documentsAdded: number;
          readonly documentsUpdated: number;
          readonly documentsUnchanged: number;
          readonly documentsFailed: number;
          readonly errorSummary?: string;
        },
      ): Promise<CatalogSyncRun> {
        return {
          id: 1,
          runKind: 'EXECUTION',
          startedAt: now,
          ...input,
        };
      },
    };
    const fetcher = {
      async fetch(_request: unknown, context: unknown) {
        fetchContext = context;
        return {
          notModified: true as const,
          requestedUrl: documentUrl,
          finalUrl: documentUrl,
          redirectChain: [],
          etag: '"v2"',
        };
      },
    };

    const result = await new SyncCatalogDocuments(repository, fetcher, { now: () => now }).execute({
      sourceKey: source.sourceKey,
      documents: [
        {
          sourceKey: source.sourceKey,
          stableKey: document.stableKey,
          title: document.title,
          url: documentUrl,
          language: document.language,
          mimeType: document.mimeType,
          enabled: true,
        },
      ],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(fetchContext).toEqual({
      cacheValidators: {
        contentHash: version.contentHash,
        etag: version.etag,
        lastModified: version.lastModified,
        validatorUrl: documentUrl,
      },
    });
    expect(observation).toEqual({
      syncRunId: 1,
      aliases: [],
      events: [],
      currentVersionValidators: { etag: '"v2"' },
    });
    expect(result).toMatchObject({
      unchangedCount: 1,
      failedCount: 0,
      documents: [{ stableKey: 'guide', status: 'unchanged' }],
    });
  });
});
