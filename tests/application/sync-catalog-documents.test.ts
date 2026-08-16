import { describe, expect, it } from 'vitest';

import type {
  ContentFetchContext,
  ContentFetchRequest,
  ContentFetcher,
} from '../../src/application/ports/content-fetcher.js';
import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import {
  ContentProviderUnavailableError,
  HttpError,
} from '../../src/domain/errors/domain-errors.js';
import type {
  CatalogDocument,
  CatalogDocumentInput,
  CatalogDocumentObservationInput,
  CatalogDocumentRevision,
  CatalogDocumentRevisionInput,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunStartInput,
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
  private readonly runs = new Map<number, CatalogSyncRun>();
  public readonly versions: DocumentVersionInput[] = [];
  public readonly sections: DocumentSectionInput[][] = [];
  public readonly upserts: CatalogDocumentInput[] = [];
  public readonly observations: CatalogDocumentObservationInput[] = [];
  public readonly touches: number[] = [];
  public readonly startedRuns: CatalogSyncRunStartInput[] = [];
  public readonly completedRuns: CatalogSyncRunCompletionInput[] = [];

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

  public async commitDocumentRevision(
    input: CatalogDocumentRevisionInput,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocumentRevision> {
    const document = await this.upsertDocument(input.document, observation);
    const version = await this.addDocumentVersion({
      ...input.version,
      documentId: document.id,
      isCurrent: true,
    });
    const sections = await this.replaceDocumentSections(version.id, input.sections);
    return {
      document: { ...document, currentVersionId: version.id },
      version,
      sections,
    };
  }

  public async upsertDocument(
    input: CatalogDocumentInput,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocument> {
    this.upserts.push(input);
    if (observation !== undefined) this.observations.push(observation);
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

  public async touchDocumentObservation(
    documentId: number,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocument> {
    this.touches.push(documentId);
    if (observation !== undefined) this.observations.push(observation);
    if (this.existingDocument === undefined) throw new Error('DOCUMENT_NOT_FOUND');
    return { ...this.existingDocument, lastSeenAt: now };
  }

  public async recordDocumentObservation(
    documentId: number,
    observation: CatalogDocumentObservationInput,
  ): Promise<void> {
    void documentId;
    this.observations.push(observation);
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

  public async startCatalogSyncRun(input: CatalogSyncRunStartInput): Promise<CatalogSyncRun> {
    this.startedRuns.push(input);
    const syncRun: CatalogSyncRun = {
      id: this.nextRunId,
      ...input,
      status: 'RUNNING',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
    };
    this.runs.set(syncRun.id, syncRun);
    this.nextRunId += 1;
    return syncRun;
  }

  public async completeCatalogSyncRun(
    syncRunId: number,
    input: CatalogSyncRunCompletionInput,
  ): Promise<CatalogSyncRun> {
    this.completedRuns.push(input);
    const running = this.runs.get(syncRunId);
    if (running === undefined) throw new Error('RUN_NOT_FOUND');
    const syncRun = { ...running, ...input };
    this.runs.set(syncRunId, syncRun);
    return syncRun;
  }
}

class ContentFetcherStub implements ContentFetcher {
  public readonly requests: ContentFetchRequest[] = [];
  public readonly contexts: (ContentFetchContext | undefined)[] = [];
  private readonly results: (ContentFetchResult | Error)[];

  public constructor(
    result: ContentFetchResult | Error | readonly (ContentFetchResult | Error)[] = fetchedContent(),
  ) {
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
  it('starts the sync before work and completes it later with terminal counters', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub();
    const timestamps = [new Date(1_000), new Date(2_000)];
    const advancingClock = {
      now: () => {
        const timestamp = timestamps.shift();
        if (timestamp === undefined) throw new Error('CLOCK_EXHAUSTED');
        return timestamp;
      },
    };

    const result = await new SyncCatalogDocuments(repository, fetcher, advancingClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(repository.startedRuns).toEqual([
      { sourceId: enabledSource.id, startedAt: new Date(1_000) },
    ]);
    expect(repository.completedRuns).toEqual([
      {
        completedAt: new Date(2_000),
        status: 'SUCCESS',
        documentsChecked: 1,
        documentsAdded: 1,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
      },
    ]);
    expect(result.syncRun).toMatchObject({
      startedAt: new Date(1_000),
      completedAt: new Date(2_000),
      status: 'SUCCESS',
    });
  });

  it('completes a running sync as failed when processing aborts unexpectedly', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub([
      fetchedContent({ contentHash: 'guide-hash' }),
      fetchedContent({ contentHash: 'api-hash' }),
    ]);
    const timestamps = [new Date(1_000), new Date(2_000)];
    const advancingClock = {
      now: () => {
        const timestamp = timestamps.shift();
        if (timestamp === undefined) throw new Error('CLOCK_EXHAUSTED');
        return timestamp;
      },
    };
    const abortingDelay = () => Promise.reject(new Error('RATE_LIMIT_ABORTED'));
    const synchronization = new SyncCatalogDocuments(
      repository,
      fetcher,
      advancingClock,
      abortingDelay,
    ).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument, secondDeclaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
      rateLimitMs: 1,
    });

    await expect(synchronization).rejects.toThrow('RATE_LIMIT_ABORTED');
    expect(fetcher.requests).toHaveLength(1);
    expect(repository.completedRuns).toEqual([
      {
        completedAt: new Date(2_000),
        status: 'FAILED',
        documentsChecked: 1,
        documentsAdded: 1,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
        errorSummary: 'Synchronization aborted before completion',
      },
    ]);
  });

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

    const result = await new SyncCatalogDocuments(
      repository,
      fetcher,
      fixedClock,
      (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    ).execute({
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
        redirectChain,
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
    expect(repository.observations).toEqual([
      {
        syncRunId: 1,
        aliases: [{ url: 'https://docs.example/guide.html', aliasType: 'REDIRECT' }],
        events: [
          {
            eventType: 'PERMANENT_REDIRECT',
            detailsJson: JSON.stringify({ redirectChain }),
          },
        ],
      },
    ]);
  });

  it('records canonical and content hash changes with deduplicated aliases', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
    const fetcher = new ContentFetcherStub(
      fetchedContent({
        finalUrl: 'https://docs.example/served-guide.html',
        canonicalUrl: 'https://docs.example/canonical-guide.html',
        contentHash: 'content-hash-v2',
      }),
    );

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(result.documents[0]).toMatchObject({ status: 'updated' });
    expect(repository.observations).toEqual([
      {
        syncRunId: 1,
        aliases: [
          { url: existingDocument.canonicalUrl, aliasType: 'OLD_URL' },
          { url: 'https://docs.example/served-guide.html', aliasType: 'CANONICAL' },
        ],
        events: [
          {
            eventType: 'CANONICAL_CHANGED',
            detailsJson: JSON.stringify({
              previousCanonicalUrl: existingDocument.canonicalUrl,
              canonicalUrl: 'https://docs.example/canonical-guide.html',
            }),
          },
          {
            eventType: 'CONTENT_HASH_CHANGED',
            detailsJson: JSON.stringify({
              previousContentHash: currentVersion.contentHash,
              contentHash: 'content-hash-v2',
            }),
          },
        ],
      },
    ]);
  });

  it('passes current version validators and reconciles identical content', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
    const fetcher = new ContentFetcherStub(
      fetchedContent({ contentHash: currentVersion.contentHash }),
    );

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
    expect(repository.versions).toHaveLength(1);
    expect(repository.sections).toHaveLength(1);
  });

  it('keeps an existing document unchanged when the remote source returns not modified', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
    const fetcher = new ContentFetcherStub({
      notModified: true,
      requestedUrl: declaredDocument.url,
      finalUrl: declaredDocument.url,
      redirectChain: [],
    });

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
    expect(repository.touches).toEqual([existingDocument.id]);
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('preserves a permanent redirect observed with 304 without creating content churn', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
    const redirectChain = [
      {
        fromUrl: existingDocument.canonicalUrl,
        toUrl: 'https://docs.example/new-guide.html',
        status: 301,
        permanent: true,
      },
    ];
    const fetcher = new ContentFetcherStub({
      notModified: true,
      requestedUrl: declaredDocument.url,
      finalUrl: 'https://docs.example/new-guide.html',
      redirectChain,
    });

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(result.documents[0]).toMatchObject({
      status: 'unchanged',
      document: {
        stableKey: existingDocument.stableKey,
        canonicalUrl: 'https://docs.example/new-guide.html',
        status: 'REDIRECTED',
      },
    });
    expect(repository.upserts).toEqual([
      expect.objectContaining({
        stableKey: existingDocument.stableKey,
        canonicalUrl: 'https://docs.example/new-guide.html',
        status: 'REDIRECTED',
      }),
    ]);
    expect(repository.observations).toEqual([
      {
        syncRunId: 1,
        aliases: [{ url: existingDocument.canonicalUrl, aliasType: 'REDIRECT' }],
        events: [
          {
            eventType: 'PERMANENT_REDIRECT',
            detailsJson: JSON.stringify({ redirectChain }),
          },
          {
            eventType: 'CANONICAL_CHANGED',
            detailsJson: JSON.stringify({
              previousCanonicalUrl: existingDocument.canonicalUrl,
              canonicalUrl: 'https://docs.example/new-guide.html',
            }),
          },
        ],
      },
    ]);
    expect(repository.touches).toHaveLength(0);
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('marks an existing document stale without replacing versions when it returns 404', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
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
    expect(repository.observations).toEqual([
      {
        syncRunId: 1,
        events: [
          {
            eventType: 'HTTP_404',
            detailsJson: JSON.stringify({ status: 404, requestedUrl: declaredDocument.url }),
          },
        ],
      },
    ]);
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('marks an existing document removed without replacing versions when it returns 410', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
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
    expect(repository.observations).toEqual([
      {
        syncRunId: 1,
        events: [
          {
            eventType: 'HTTP_410',
            detailsJson: JSON.stringify({ status: 410, requestedUrl: declaredDocument.url }),
          },
        ],
      },
    ]);
    expect(repository.versions).toHaveLength(0);
    expect(repository.sections).toHaveLength(0);
  });

  it('records source unavailability and completes a failed run with counters', async () => {
    const repository = new CatalogSyncRepositoryStub(
      [enabledSource],
      existingDocument,
      currentVersion,
    );
    const fetcher = new ContentFetcherStub(
      new ContentProviderUnavailableError('Content provider unavailable'),
    );

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [declaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(result).toMatchObject({
      checkedCount: 1,
      failedCount: 1,
      syncRun: {
        status: 'FAILED',
        documentsChecked: 1,
        documentsFailed: 1,
        errorSummary: '1 document(s) failed',
      },
      documents: [{ status: 'failed', error: 'Content provider unavailable' }],
    });
    expect(repository.observations).toEqual([
      {
        syncRunId: 1,
        events: [
          {
            eventType: 'SOURCE_UNAVAILABLE',
            detailsJson: JSON.stringify({ code: 'CONTENT_PROVIDER_UNAVAILABLE' }),
          },
        ],
      },
    ]);
    expect(repository.completedRuns[0]).toMatchObject({
      status: 'FAILED',
      documentsChecked: 1,
      documentsFailed: 1,
    });
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
  metadataJson: JSON.stringify({ extractionContractVersion: 1 }),
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
    redirectChain: [],
    metadata: {},
    links: [],
    ...overrides,
  };
}
