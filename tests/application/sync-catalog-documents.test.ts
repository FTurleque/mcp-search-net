import { describe, expect, it } from 'vitest';

import type {
  ContentFetchContext,
  ContentFetchRequest,
  ContentFetcher,
} from '../../src/application/ports/content-fetcher.js';
import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import { HttpError } from '../../src/domain/errors/domain-errors.js';
import type {
  CatalogDocument,
  CatalogDocumentInput,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunInput,
  DocumentSection,
  DocumentSectionInput,
  DocumentVersion,
  DocumentVersionInput,
} from '../../src/domain/models/catalog.js';
import type { ContentFetchResult, FetchedContent } from '../../src/domain/models/content.js';

class CatalogSyncRepositoryStub {
  private nextDocumentId = 1;
  private nextVersionId = 1;
  private nextRunId = 1;
  public readonly versions: DocumentVersionInput[] = [];
  public readonly sections: DocumentSectionInput[][] = [];
  public readonly upserts: CatalogDocumentInput[] = [];

  public constructor(
    private readonly sources: readonly CatalogSource[],
    private readonly existingDocument?: CatalogDocument,
    private readonly currentVersion?: DocumentVersion,
  ) {}

  public async listSources(): Promise<readonly CatalogSource[]> {
    return this.sources;
  }

  public async getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined> {
    void publicId;
    return this.existingDocument;
  }

  public async getCurrentDocumentVersion(documentId: number): Promise<DocumentVersion | undefined> {
    return this.currentVersion?.documentId === documentId ? this.currentVersion : undefined;
  }

  public async upsertDocument(input: CatalogDocumentInput): Promise<CatalogDocument> {
    this.upserts.push(input);
    if (this.existingDocument !== undefined) {
      return {
        ...this.existingDocument,
        ...input,
        lastSeenAt: now,
        updatedAt: now,
      };
    }

    const document: CatalogDocument = {
      id: this.nextDocumentId,
      ...input,
      currentVersionId: this.nextVersionId,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.nextDocumentId += 1;
    return document;
  }

  public async addDocumentVersion(input: DocumentVersionInput): Promise<DocumentVersion> {
    this.versions.push(input);
    const version: DocumentVersion = {
      id: this.nextVersionId,
      ...input,
      fetchedAt: now,
    };
    this.nextVersionId += 1;
    return version;
  }

  public async replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): Promise<readonly DocumentSection[]> {
    this.sections.push([...sections]);
    return sections.map((section, index) => ({
      id: index + 1,
      documentVersionId,
      ...section,
    }));
  }

  public async addCatalogSyncRun(input: CatalogSyncRunInput): Promise<CatalogSyncRun> {
    const syncRun: CatalogSyncRun = {
      id: this.nextRunId,
      ...input,
    };
    this.nextRunId += 1;
    return syncRun;
  }
}

class ContentFetcherStub implements ContentFetcher {
  public readonly requests: ContentFetchRequest[] = [];
  public readonly contexts: Array<ContentFetchContext | undefined> = [];
  private readonly results: Array<ContentFetchResult | Error>;

  public constructor(result: ContentFetchResult | Error | readonly (ContentFetchResult | Error)[] = fetchedContent()) {
    this.results = Array.isArray(result) ? [...result] : [result];
  }

  public async fetch(
    request: ContentFetchRequest,
    context?: ContentFetchContext,
  ): Promise<ContentFetchResult> {
    this.requests.push(request);
    this.contexts.push(context);
    const result = this.results.length > 1 ? this.results.shift() : this.results[0];
    if (result === undefined) throw new Error('FETCH_RESULT_NOT_CONFIGURED');
    if (result instanceof Error) throw result;
    return result;
  }
}

describe('SyncCatalogDocuments', () => {
  it('fetches one declared document, stores extracted sections and records a successful run', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub();

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.contexts[0]).toBeUndefined();
    expect(result).toMatchObject({
      schemaVersion: '1.0',
      dryRun: false,
      checkedCount: 1,
      addedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      rateLimitMs: 0,
      limited: false,
      syncRun: {
        id: 1,
        sourceId: enabledSource.id,
        status: 'SUCCESS',
        documentsChecked: 1,
        documentsAdded: 1,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
      },
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          title: 'Fetched Guide',
          url: 'https://docs.example/guide.html',
          status: 'added',
          sectionCount: 2,
        },
      ],
    });
    expect(repository.versions[0]).toMatchObject({
      contentHash: 'content-hash',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
    });
    expect(repository.sections[0]).toHaveLength(2);
    expect(repository.sections[0]?.[0]).toMatchObject({
      ordinal: 0,
      heading: 'Overview',
      headingPath: 'Overview',
      anchor: 'overview',
      content: '## Overview\n\nContent body.',
    });
    expect(repository.sections[0]?.[1]).toMatchObject({
      ordinal: 1,
      heading: 'Usage',
      headingPath: 'Usage',
      anchor: 'usage',
      content: '## Usage\n\nRun it.',
    });
  });

  it('syncs all enabled configured documents when no limit is provided', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub([
      fetchedContent({ contentHash: 'guide-hash' }),
      fetchedContent({
        requestedUrl: 'https://docs.example/api.html',
        finalUrl: 'https://docs.example/api.html',
        canonicalUrl: 'https://docs.example/api.html',
        title: 'Fetched API',
        contentHash: 'api-hash',
      }),
    ]);

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument, secondDeclaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(fetcher.requests).toHaveLength(2);
    expect(result).toMatchObject({
      checkedCount: 2,
      addedCount: 2,
      failedCount: 0,
      limited: false,
      documents: [
        { stableKey: 'guide', status: 'added' },
        { stableKey: 'api', status: 'added' },
      ],
    });
  });

  it('applies an application rate limit between document fetches', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub([
      fetchedContent({ contentHash: 'guide-hash' }),
      fetchedContent({ contentHash: 'api-hash' }),
    ]);
    const delays: number[] = [];

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock, (milliseconds) => {
      delays.push(milliseconds);
      return Promise.resolve();
    }).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument, secondDeclaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
      rateLimitMs: 250,
    });

    expect(fetcher.requests).toHaveLength(2);
    expect(delays).toEqual([250]);
    expect(result.rateLimitMs).toBe(250);
  });

  it('resumes after a previously processed document cursor', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub(fetchedContent({ contentHash: 'api-hash' }));

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument, secondDeclaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
      resumeAfter: { sourceKey: 'enabled-docs', stableKey: 'guide' },
    });

    expect(fetcher.requests).toHaveLength(1);
    expect(result).toMatchObject({
      checkedCount: 1,
      resumeAfter: { sourceKey: 'enabled-docs', stableKey: 'guide' },
      documents: [{ stableKey: 'api', status: 'added' }],
    });
  });

  it('marks a permanently redirected document without changing its stable key', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const redirectChain = [
      {
        fromUrl: 'https://docs.example/guide.html',
        toUrl: 'https://docs.example/new-guide.html',
        status: 301,
        permanent: true,
      },
    ];
    const fetcher = new ContentFetcherStub(
      fetchedContent({
        finalUrl: 'https://docs.example/new-guide.html',
        canonicalUrl: 'https://docs.example/new-guide.html',
        contentHash: 'redirected-content-hash',
        metadata: { redirectChain, redirectedPermanently: true },
      }),
    );

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(repository.upserts[0]).toMatchObject({
      stableKey: 'guide',
      canonicalUrl: 'https://docs.example/new-guide.html',
      status: 'REDIRECTED',
    });
    expect(result.documents[0]).toMatchObject({
      status: 'added',
      document: {
        stableKey: 'guide',
        canonicalUrl: 'https://docs.example/new-guide.html',
        status: 'REDIRECTED',
      },
    });
    const metadata = JSON.parse(repository.versions[0]?.metadataJson ?? '{}') as {
      redirectChain?: unknown;
      redirectedPermanently?: boolean;
    };
    expect(metadata.redirectedPermanently).toBe(true);
    expect(metadata.redirectChain).toEqual(redirectChain);
  });

  it('passes current version validators and does not duplicate identical content', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource], existingDocument, currentVersion);
    const fetcher = new ContentFetcherStub(fetchedContent({ contentHash: currentVersion.contentHash }));

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(fetcher.contexts[0]).toEqual({
      cacheValidators: {
        contentHash: 'content-hash',
        etag: '"v1"',
        lastModified: 'Tue, 02 Jul 2026 10:00:00 GMT',
      },
    });
    expect(result).toMatchObject({
      checkedCount: 1,
      addedCount: 0,
      updatedCount: 0,
      unchangedCount: 1,
      failedCount: 0,
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          status: 'unchanged',
        },
      ],
    });
    expect(repository.upserts).toHaveLength(1);
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('keeps an existing document unchanged when the remote source returns not modified', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource], existingDocument, currentVersion);
    const fetcher = new ContentFetcherStub({ notModified: true });

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(fetcher.contexts[0]?.cacheValidators).toMatchObject({
      contentHash: 'content-hash',
      etag: '"v1"',
      lastModified: 'Tue, 02 Jul 2026 10:00:00 GMT',
    });
    expect(result).toMatchObject({
      checkedCount: 1,
      addedCount: 0,
      updatedCount: 0,
      unchangedCount: 1,
      failedCount: 0,
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          status: 'unchanged',
          document: existingDocument,
        },
      ],
    });
    expect(repository.upserts).toHaveLength(0);
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('marks an existing document stale without replacing versions when it returns 404', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource], existingDocument, currentVersion);
    const fetcher = new ContentFetcherStub(new HttpError('Remote server returned HTTP 404', 404));

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(result).toMatchObject({
      checkedCount: 1,
      addedCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      failedCount: 0,
      syncRun: {
        status: 'SUCCESS',
        documentsUpdated: 1,
        documentsFailed: 0,
      },
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          status: 'updated',
          error: 'HTTP_404_STALE',
          document: {
            id: existingDocument.id,
            status: 'STALE',
            currentVersionId: currentVersion.id,
          },
        },
      ],
    });
    expect(repository.upserts).toHaveLength(1);
    expect(repository.upserts[0]).toMatchObject({
      canonicalUrl: existingDocument.canonicalUrl,
      status: 'STALE',
    });
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('marks an existing document removed without replacing versions when it returns 410', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource], existingDocument, currentVersion);
    const fetcher = new ContentFetcherStub(new HttpError('Remote server returned HTTP 410', 410));

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(result).toMatchObject({
      checkedCount: 1,
      addedCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      failedCount: 0,
      syncRun: {
        status: 'SUCCESS',
        documentsUpdated: 1,
        documentsFailed: 0,
      },
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          status: 'updated',
          error: 'HTTP_410_REMOVED',
          document: {
            id: existingDocument.id,
            status: 'REMOVED',
            currentVersionId: currentVersion.id,
          },
        },
      ],
    });
    expect(repository.upserts).toHaveLength(1);
    expect(repository.upserts[0]).toMatchObject({
      canonicalUrl: existingDocument.canonicalUrl,
      status: 'REMOVED',
    });
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });
});

const now = new Date(1_000);
const fixedClock = { now: () => now };

const enabledSource: CatalogSource = {
  id: 1,
  sourceKey: 'enabled-docs',
  displayName: 'Enabled Documentation',
  baseUrl: 'https://docs.example/',
  sourceType: 'documentation',
  language: 'en-US',
  freshnessPolicy: 'weekly',
  syncStrategy: 'manual',
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const declaredDocument = {
  sourceKey: 'enabled-docs',
  stableKey: 'guide',
  title: 'Guide',
  url: 'https://docs.example/guide.html',
  language: 'en-US',
  mimeType: 'text/html',
  enabled: true,
};

const secondDeclaredDocument = {
  sourceKey: 'enabled-docs',
  stableKey: 'api',
  title: 'API',
  url: 'https://docs.example/api.html',
  language: 'en-US',
  mimeType: 'text/html',
  enabled: true,
};

const existingDocument: CatalogDocument = {
  id: 42,
  publicId: 'doc_existing',
  sourceId: enabledSource.id,
  canonicalUrl: 'https://docs.example/guide.html',
  stableKey: 'guide',
  title: 'Guide',
  mimeType: 'text/html',
  language: 'en-US',
  status: 'ACTIVE',
  currentVersionId: 7,
  firstSeenAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

const currentVersion: DocumentVersion = {
  id: 7,
  documentId: existingDocument.id,
  contentHash: 'content-hash',
  etag: '"v1"',
  lastModified: 'Tue, 02 Jul 2026 10:00:00 GMT',
  fetchedAt: now,
  isCurrent: true,
  extractionMode: 'static',
  contentType: 'text/html',
  metadataJson: '{}',
};

function fetchedContent(overrides: Partial<FetchedContent> = {}): FetchedContent {
  return {
    requestedUrl: 'https://docs.example/guide.html',
    finalUrl: 'https://docs.example/guide.html',
    canonicalUrl: 'https://docs.example/guide.html',
    title: 'Fetched Guide',
    markdown: '# Fetched Guide\n\n## Overview\n\nContent body.\n\n## Usage\n\nRun it.',
    documentSections: [
      { heading: 'Overview', markdown: '## Overview\n\nContent body.' },
      { heading: 'Usage', markdown: '## Usage\n\nRun it.' },
    ],
    contentType: 'text/html',
    fetchedAt: now.toISOString(),
    extractionMode: 'static',
    statusCode: 200,
    contentHash: 'content-hash',
    metadata: {},
    links: [],
    ...overrides,
  };
}
