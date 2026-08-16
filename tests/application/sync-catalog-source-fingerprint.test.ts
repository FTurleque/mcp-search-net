import { describe, expect, it } from 'vitest';

import type { CatalogRepository } from '../../src/application/ports/catalog-repository.js';
import type {
  ContentFetchContext,
  ContentFetchRequest,
  ContentFetcher,
} from '../../src/application/ports/content-fetcher.js';
import {
  SyncCatalogDocuments,
  type SyncCatalogResumeCursor,
} from '../../src/application/use-cases/sync-catalog-documents.js';
import type {
  CatalogDocument,
  CatalogDocumentRevision,
  CatalogDocumentRevisionInput,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunStartInput,
  DocumentVersion,
} from '../../src/domain/models/catalog.js';
import type { ContentFetchResult, FetchedContent } from '../../src/domain/models/content.js';

const now = new Date('2026-08-16T00:00:00.000Z');
const clock = { now: () => now };
const documents = [
  {
    sourceKey: 'docs',
    stableKey: 'guide',
    title: 'Guide',
    url: 'https://docs.example/guide',
    language: 'en-US',
    mimeType: 'text/html',
    enabled: true,
  },
  {
    sourceKey: 'docs',
    stableKey: 'api',
    title: 'API',
    url: 'https://docs.example/api',
    language: 'en-US',
    mimeType: 'text/html',
    enabled: true,
  },
] as const;

class SourceStateRepository
  implements
    Pick<
      CatalogRepository,
      | 'listSources'
      | 'getDocumentByPublicId'
      | 'getCurrentDocumentVersion'
      | 'upsertDocument'
      | 'touchDocumentObservation'
      | 'recordDocumentObservation'
      | 'commitDocumentRevision'
      | 'startCatalogSyncRun'
      | 'completeCatalogSyncRun'
    >
{
  public startCalls = 0;
  private nextRunId = 1;

  public constructor(private readonly sourceEnabled: boolean) {}

  public async listSources(): Promise<readonly CatalogSource[]> {
    return [source(this.sourceEnabled)];
  }

  public async getDocumentByPublicId(): Promise<CatalogDocument | undefined> {
    return undefined;
  }

  public async getCurrentDocumentVersion(): Promise<DocumentVersion | undefined> {
    return undefined;
  }

  public async upsertDocument(): Promise<CatalogDocument> {
    throw new Error('UNUSED_UPSERT');
  }

  public async touchDocumentObservation(): Promise<CatalogDocument> {
    throw new Error('UNUSED_TOUCH');
  }

  public async recordDocumentObservation(): Promise<void> {
    throw new Error('UNUSED_OBSERVATION');
  }

  public async commitDocumentRevision(
    input: CatalogDocumentRevisionInput,
  ): Promise<CatalogDocumentRevision> {
    const document: CatalogDocument = {
      id: 10,
      ...input.document,
      currentVersionId: 20,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const version: DocumentVersion = {
      id: 20,
      documentId: document.id,
      ...input.version,
      fetchedAt: now,
      isCurrent: true,
    };
    return {
      document,
      version,
      sections: input.sections.map((section, index) => ({
        id: index + 1,
        documentVersionId: version.id,
        ...section,
      })),
    };
  }

  public async startCatalogSyncRun(input: CatalogSyncRunStartInput): Promise<CatalogSyncRun> {
    this.startCalls += 1;
    const run: CatalogSyncRun = {
      id: this.nextRunId,
      ...input,
      status: 'RUNNING',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
    };
    this.nextRunId += 1;
    return run;
  }

  public async completeCatalogSyncRun(
    syncRunId: number,
    input: CatalogSyncRunCompletionInput,
  ): Promise<CatalogSyncRun> {
    return {
      id: syncRunId,
      sourceId: 1,
      runKind: 'EXECUTION',
      startedAt: now,
      ...input,
    };
  }
}

class SourceStateFetcher implements ContentFetcher {
  public calls = 0;

  public async fetch(
    request: ContentFetchRequest,
    context?: ContentFetchContext,
  ): Promise<ContentFetchResult> {
    void context;
    this.calls += 1;
    return fetchedContent(request.url.value);
  }
}

describe('SyncCatalogDocuments source-state fingerprint', () => {
  it('rejects resume when the persisted source enabled state changed before run creation', async () => {
    const first = await new SyncCatalogDocuments(
      new SourceStateRepository(true),
      new SourceStateFetcher(),
      clock,
    ).execute({
      sourceKey: 'docs',
      documents,
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    const cursor = requireResumeCursor(first.resumeAfter);
    const fingerprint = requireFingerprint(first.resumeConfigurationFingerprint);
    const resumedRepository = new SourceStateRepository(false);
    const resumedFetcher = new SourceStateFetcher();

    await expect(
      new SyncCatalogDocuments(resumedRepository, resumedFetcher, clock).execute({
        sourceKey: 'docs',
        documents,
        timeoutMs: 1_000,
        maxResponseBytes: 10_000,
        maxRedirects: 3,
        resumeAfter: cursor,
        resumeConfigurationFingerprint: fingerprint,
      }),
    ).rejects.toThrow('CATALOG_RESUME_CONFIGURATION_CHANGED');

    expect(resumedRepository.startCalls).toBe(0);
    expect(resumedFetcher.calls).toBe(0);
  });
});

function source(enabled: boolean): CatalogSource {
  return {
    id: 1,
    sourceKey: 'docs',
    displayName: 'Docs',
    baseUrl: 'https://docs.example/',
    sourceType: 'documentation',
    language: 'en-US',
    freshnessPolicy: 'weekly',
    syncStrategy: 'manual',
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

function requireResumeCursor(value: SyncCatalogResumeCursor | undefined): SyncCatalogResumeCursor {
  if (value === undefined) throw new Error('EXPECTED_RESUME_CURSOR');
  return value;
}

function requireFingerprint(value: string | undefined): string {
  if (value === undefined) throw new Error('EXPECTED_RESUME_FINGERPRINT');
  return value;
}

function fetchedContent(url: string): FetchedContent {
  return {
    requestedUrl: url,
    finalUrl: url,
    canonicalUrl: url,
    title: 'Fetched document',
    markdown: '# Fetched document',
    documentSections: [{ heading: 'Fetched document', markdown: '# Fetched document' }],
    contentType: 'text/html',
    fetchedAt: now.toISOString(),
    extractionMode: 'static',
    statusCode: 200,
    contentHash: `hash-${url}`,
    redirectChain: [],
    metadata: {},
    links: [],
  };
}
