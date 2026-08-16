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

const source: CatalogSource = {
  id: 1,
  sourceKey: 'docs',
  displayName: 'Docs',
  baseUrl: 'https://docs.example/',
  sourceType: 'documentation',
  language: 'en-US',
  freshnessPolicy: 'weekly',
  syncStrategy: 'manual',
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const guide = {
  sourceKey: 'docs',
  stableKey: 'guide',
  title: 'Guide',
  url: 'https://docs.example/guide',
  language: 'en-US',
  mimeType: 'text/html',
  enabled: true,
};

const api = {
  sourceKey: 'docs',
  stableKey: 'api',
  title: 'API',
  url: 'https://docs.example/api',
  language: 'en-US',
  mimeType: 'text/html',
  enabled: true,
};

class ResumeRepository
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

  public async listSources(): Promise<readonly CatalogSource[]> {
    return [source];
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
      sourceId: source.id,
      startedAt: now,
      ...input,
    };
  }
}

class ResumeFetcher implements ContentFetcher {
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

describe('SyncCatalogDocuments resume fingerprint', () => {
  it('emits a fingerprint and resumes only against the same ordered configuration', async () => {
    const firstRepository = new ResumeRepository();
    const firstFetcher = new ResumeFetcher();
    const first = await new SyncCatalogDocuments(firstRepository, firstFetcher, clock).execute({
      sourceKey: source.sourceKey,
      documents: [guide, api],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(first).toMatchObject({
      limited: true,
      resumeAfter: { sourceKey: 'docs', stableKey: 'guide' },
    });
    expect(first.resumeConfigurationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstFetcher.calls).toBe(1);

    const cursor = requireResumeCursor(first.resumeAfter);
    const fingerprint = requireFingerprint(first.resumeConfigurationFingerprint);
    const resumedRepository = new ResumeRepository();
    const resumedFetcher = new ResumeFetcher();
    const resumed = await new SyncCatalogDocuments(
      resumedRepository,
      resumedFetcher,
      clock,
    ).execute({
      sourceKey: source.sourceKey,
      documents: [guide, api],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
      resumeAfter: cursor,
      resumeConfigurationFingerprint: fingerprint,
    });

    expect(resumed.documents).toHaveLength(1);
    expect(resumed.documents[0]).toMatchObject({ stableKey: 'api', status: 'added' });
    expect(resumedFetcher.calls).toBe(1);
  });

  it('rejects a reordered configuration before starting a sync run', async () => {
    const first = await new SyncCatalogDocuments(
      new ResumeRepository(),
      new ResumeFetcher(),
      clock,
    ).execute({
      sourceKey: source.sourceKey,
      documents: [guide, api],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });
    const cursor = requireResumeCursor(first.resumeAfter);
    const fingerprint = requireFingerprint(first.resumeConfigurationFingerprint);
    const repository = new ResumeRepository();
    const fetcher = new ResumeFetcher();

    await expect(
      new SyncCatalogDocuments(repository, fetcher, clock).execute({
        sourceKey: source.sourceKey,
        documents: [api, guide],
        timeoutMs: 1_000,
        maxResponseBytes: 10_000,
        maxRedirects: 3,
        resumeAfter: cursor,
        resumeConfigurationFingerprint: fingerprint,
      }),
    ).rejects.toThrow('CATALOG_RESUME_CONFIGURATION_CHANGED');

    expect(repository.startCalls).toBe(0);
    expect(fetcher.calls).toBe(0);
  });
});

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
