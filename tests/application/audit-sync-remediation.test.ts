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
import type { ContentFetchResult } from '../../src/domain/models/content.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('audit sync remediation', () => {
  it('returns the last processed document as continuation cursor when limited', async () => {
    const fixture = await createRepository();
    const fetcher = new RecordingFetcher();
    const first = declaredDocument(
      'first',
      'https://example.test/docs/first?utm_source=required&b=2&a=1',
    );
    const second = declaredDocument('second', 'https://example.test/docs/second');

    const result = await new SyncCatalogDocuments(fixture.repository, fetcher, fixedClock).execute({
      sourceKey: 'docs',
      documents: [first, second],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 100_000,
      maxRedirects: 3,
    });

    expect(result.limited).toBe(true);
    expect(result.resumeAfter).toEqual({ sourceKey: 'docs', stableKey: 'first' });
    expect(result.documents).toHaveLength(1);
    expect(fetcher.requests[0]?.url.value).toBe(
      'https://example.test/docs/first?utm_source=required&b=2&a=1',
    );
  });
});

async function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-sync-audit-'));
  roots.push(root);
  const repository = new SqliteCatalogRepository(join(root, 'catalog.db'), fixedClock);
  repositories.push(repository);
  await repository.addSource({
    sourceKey: 'docs',
    displayName: 'Docs',
    baseUrl: 'https://example.test/docs/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  return { repository };
}

function declaredDocument(stableKey: string, url: string) {
  return {
    sourceKey: 'docs',
    stableKey,
    title: stableKey,
    url,
    language: 'en',
    mimeType: 'text/html',
    enabled: true,
  } as const;
}

class RecordingFetcher implements ContentFetcher {
  public readonly requests: ContentFetchRequest[] = [];

  public fetch(
    request: ContentFetchRequest,
    _context?: ContentFetchContext,
  ): Promise<ContentFetchResult> {
    this.requests.push(request);
    return Promise.resolve({
      requestedUrl: request.url.value,
      finalUrl: request.url.value,
      canonicalUrl: request.url.value,
      title: 'Fetched',
      markdown: '# Fetched\n\nUseful documentation content.',
      documentSections: [
        { heading: 'Fetched', markdown: '# Fetched\n\nUseful documentation content.' },
      ],
      contentType: 'text/html',
      fetchedAt: '2026-08-07T00:00:00.000Z',
      extractionMode: 'static',
      statusCode: 200,
      contentHash: request.url.value,
      redirectChain: [],
      metadata: {},
      links: [],
    });
  }
}

const fixedClock = { now: () => new Date('2026-08-07T00:00:00.000Z') };
