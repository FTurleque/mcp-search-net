import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ContentFetchContext,
  ContentFetchRequest,
  ContentFetcher,
} from '../../src/application/ports/content-fetcher.js';
import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import type { ContentFetchResult, FetchedContent } from '../../src/domain/models/content.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];
const fixedClock = { now: () => new Date('2026-08-12T12:00:00.000Z') };
const document = {
  sourceKey: 'docs',
  stableKey: 'guide',
  title: 'Guide',
  url: 'https://docs.example/guide',
  language: 'en-US',
  mimeType: 'text/html',
  enabled: true,
} as const;

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('final audit catalog reconciliation', () => {
  it('refreshes validators, metadata and derived sections on a same-hash HTTP 200 without duplicating versions', async () => {
    const repository = createRepository();
    await repository.addSource({
      sourceKey: 'docs',
      displayName: 'Docs',
      baseUrl: 'https://docs.example/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });

    await sync(repository, new QueueFetcher([fetched({
      etag: '"v1"',
      lastModified: 'Tue, 11 Aug 2026 10:00:00 GMT',
      contentType: 'text/plain',
      finalUrl: 'https://docs.example/guide',
      markdown: 'Old representation',
      documentSections: [{ heading: 'Old', markdown: 'Old representation' }],
    })]));

    const secondFetcher = new QueueFetcher([fetched({
      etag: '"v2"',
      contentType: 'text/html',
      finalUrl: 'https://cdn.example/guide',
      markdown: '## New\n\nNew representation',
      documentSections: [{ heading: 'New', markdown: '## New\n\nNew representation' }],
    })]);
    const result = await sync(repository, secondFetcher);

    expect(result).toMatchObject({ unchangedCount: 1, updatedCount: 0, failedCount: 0 });
    const [storedDocument] = await repository.listDocuments();
    expect(storedDocument).toBeDefined();
    const versions = await repository.listDocumentVersions(storedDocument!.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      contentHash: 'same-payload-hash',
      etag: '"v2"',
      contentType: 'text/html',
    });
    expect(versions[0]?.lastModified).toBeUndefined();
    expect(JSON.parse(versions[0]!.metadataJson)).toMatchObject({
      extractionContractVersion: 1,
      finalUrl: 'https://cdn.example/guide',
    });
    const sections = await repository.listCurrentDocumentSections();
    expect(sections).toHaveLength(1);
    expect(sections[0]?.section).toMatchObject({ heading: 'New', content: '## New\n\nNew representation' });
    expect(secondFetcher.contexts[0]?.cacheValidators).toMatchObject({
      etag: '"v1"',
      validatorUrl: 'https://docs.example/guide',
    });
  });

  it('forces a full fetch when the stored extraction contract is absent', async () => {
    const repository = createRepository();
    const source = await repository.addSource({
      sourceKey: 'docs',
      displayName: 'Docs',
      baseUrl: 'https://docs.example/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    await repository.commitDocumentRevision({
      document: {
        publicId: 'doc_33de0d043416e86cb18abf23',
        sourceId: source.id,
        canonicalUrl: document.url,
        stableKey: document.stableKey,
        title: document.title,
        mimeType: document.mimeType,
        language: document.language,
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'same-payload-hash',
        etag: '"legacy"',
        extractionMode: 'static',
        contentType: 'text/html',
        metadataJson: JSON.stringify({ finalUrl: document.url }),
      },
      sections: [{ ordinal: 0, content: 'legacy', contentHash: 'legacy', characterCount: 6 }],
    });

    const fetcher = new QueueFetcher([fetched({ etag: '"fresh"' })]);
    await sync(repository, fetcher);
    expect(fetcher.contexts[0]).toBeUndefined();
  });
});

function createRepository(): SqliteCatalogRepository {
  const root = mkdtempSync(join(tmpdir(), 'mcp-final-catalog-'));
  roots.push(root);
  const repository = new SqliteCatalogRepository(join(root, 'catalog.db'), fixedClock);
  repositories.push(repository);
  return repository;
}

async function sync(repository: SqliteCatalogRepository, fetcher: ContentFetcher) {
  return new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
    sourceKey: 'docs',
    documents: [document],
    timeoutMs: 1_000,
    maxResponseBytes: 10_000,
    maxRedirects: 3,
  });
}

class QueueFetcher implements ContentFetcher {
  public readonly contexts: (ContentFetchContext | undefined)[] = [];
  private readonly results: ContentFetchResult[];

  public constructor(results: ContentFetchResult[]) {
    this.results = [...results];
  }

  public async fetch(
    _request: ContentFetchRequest,
    context?: ContentFetchContext,
  ): Promise<ContentFetchResult> {
    this.contexts.push(context);
    const result = this.results.shift();
    if (result === undefined) throw new Error('FETCH_RESULT_NOT_CONFIGURED');
    return result;
  }
}

function fetched(overrides: Partial<FetchedContent> = {}): FetchedContent {
  return {
    requestedUrl: document.url,
    finalUrl: document.url,
    canonicalUrl: document.url,
    title: document.title,
    markdown: '## Guide\n\nCurrent representation',
    documentSections: [{ heading: 'Guide', markdown: '## Guide\n\nCurrent representation' }],
    contentType: 'text/html',
    fetchedAt: '2026-08-12T12:00:00.000Z',
    extractionMode: 'static',
    statusCode: 200,
    contentHash: 'same-payload-hash',
    redirectChain: [],
    metadata: {},
    links: [],
    ...overrides,
  };
}
