import { createHash } from 'node:crypto';
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
import type { FetchedContent } from '../../src/domain/models/content.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog identical-payload representation refresh', () => {
  it('refreshes validators, representation metadata, sections and FTS without creating another version', async () => {
    const { repository, sourceId, documentId } = await createCatalogWithCurrentVersion(1);
    let observedContext: ContentFetchContext | undefined;
    const fetcher: ContentFetcher = {
      async fetch(_request: ContentFetchRequest, context?: ContentFetchContext) {
        observedContext = context;
        return refreshedContent();
      },
    };

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock(2_000)).execute({
      sourceKey: 'docs',
      documents: [declaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 5,
    });

    expect(result.unchangedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(observedContext?.cacheValidators).toMatchObject({
      contentHash: 'same-payload',
      etag: '"v1"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      validatorUrl: 'https://example.test/old',
    });

    const versions = await repository.listDocumentVersions(documentId);
    expect(versions).toHaveLength(1);
    const currentVersion = await repository.getCurrentDocumentVersion(documentId);
    expect(currentVersion).toMatchObject({
      id: versions[0]?.id,
      documentId,
      contentHash: 'same-payload',
      lastModified: 'Mon, 22 Jun 2026 00:00:00 GMT',
      contentType: 'text/html',
      extractionMode: 'static',
    });
    expect(currentVersion?.etag).toBeUndefined();
    expect(JSON.parse(currentVersion?.metadataJson ?? '{}')).toMatchObject({
      finalUrl: 'https://example.test/new',
      extractionContractVersion: 1,
    });

    const sections = await repository.listCurrentDocumentSections();
    expect(sections).toHaveLength(1);
    expect(sections[0]?.document.id).toBe(documentId);
    expect(sections[0]?.section.content).toBe('Freshly extracted HTML content.');

    const search = await repository.searchDocuments({ query: 'Freshly', limit: 10 });
    expect(search).toHaveLength(1);
    expect(search[0]?.document.id).toBe(documentId);
    expect((await repository.verifyIntegrity()).issues).toEqual([]);
    expect(sourceId).toBeGreaterThan(0);
  });

  it('does not reuse HTTP validators when the stored extraction contract differs', async () => {
    const { repository } = await createCatalogWithCurrentVersion(2);
    let observedContext: ContentFetchContext | undefined;
    const fetcher: ContentFetcher = {
      async fetch(_request: ContentFetchRequest, context?: ContentFetchContext) {
        observedContext = context;
        return refreshedContent();
      },
    };

    await new SyncCatalogDocuments(repository, fetcher, fixedClock(2_000)).execute({
      sourceKey: 'docs',
      documents: [declaredDocument],
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 5,
    });

    expect(observedContext?.cacheValidators).toEqual({ contentHash: 'same-payload' });
  });
});

const declaredDocument = {
  sourceKey: 'docs',
  stableKey: 'guide',
  title: 'Guide',
  url: 'https://example.test/guide',
  language: 'en-US',
  mimeType: 'text/html',
  enabled: true,
} as const;

async function createCatalogWithCurrentVersion(extractionContractVersion: number): Promise<{
  repository: SqliteCatalogRepository;
  sourceId: number;
  documentId: number;
}> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-same-payload-'));
  roots.push(root);
  const repository = new SqliteCatalogRepository(join(root, 'catalog.db'), fixedClock(1_000));
  repositories.push(repository);
  const source = await repository.addSource({
    sourceKey: 'docs',
    displayName: 'Docs',
    baseUrl: 'https://example.test/',
    sourceType: 'documentation',
    language: 'en-US',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  const revision = await repository.commitDocumentRevision({
    document: {
      publicId: publicDocumentId('docs', 'guide'),
      sourceId: source.id,
      canonicalUrl: 'https://example.test/guide',
      stableKey: 'guide',
      title: 'Guide',
      mimeType: 'text/plain',
      language: 'en-US',
      status: 'ACTIVE',
    },
    version: {
      contentHash: 'same-payload',
      etag: '"v1"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      extractionMode: 'static',
      contentType: 'text/plain',
      metadataJson: JSON.stringify({
        ingestion: 'catalog-sync',
        sourceKey: 'docs',
        requestedUrl: 'https://example.test/guide',
        finalUrl: 'https://example.test/old',
        statusCode: 200,
        extractionContractVersion,
      }),
    },
    sections: [
      {
        ordinal: 0,
        heading: 'Guide',
        headingPath: 'Guide',
        headingLevel: 1,
        anchor: 'guide',
        content: 'Old plain-text extraction.',
        contentHash: sha256('Old plain-text extraction.'),
        characterCount: 26,
        tokenCount: 3,
      },
    ],
  });
  return { repository, sourceId: source.id, documentId: revision.document.id };
}

function refreshedContent(): FetchedContent {
  return {
    requestedUrl: 'https://example.test/guide',
    finalUrl: 'https://example.test/new',
    canonicalUrl: 'https://example.test/guide',
    title: 'Guide',
    markdown: 'Freshly extracted HTML content.',
    documentSections: [{ heading: 'Guide', markdown: 'Freshly extracted HTML content.' }],
    contentType: 'text/html',
    fetchedAt: '2026-06-22T00:00:00.000Z',
    extractionMode: 'static',
    statusCode: 200,
    lastModified: 'Mon, 22 Jun 2026 00:00:00 GMT',
    contentHash: 'same-payload',
    redirectChain: [],
    metadata: {},
    links: [],
  };
}

function fixedClock(milliseconds: number) {
  return { now: () => new Date(milliseconds) };
}

function publicDocumentId(sourceKey: string, stableKey: string): string {
  return `doc_${sha256(`${sourceKey}:${stableKey}`).slice(0, 24)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
