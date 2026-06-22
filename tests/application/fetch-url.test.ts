import { describe, expect, it } from 'vitest';

import { FetchUrl } from '../../src/application/use-cases/fetch-url.js';
import type { CacheRecord, CacheRepository } from '../../src/application/ports/cache-repository.js';
import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import type { FetchedContent } from '../../src/domain/models/content.js';
import { ExternalServiceError } from '../../src/domain/errors/domain-errors.js';

class NoCache implements CacheRepository {
  public async getSearch<T>(): Promise<CacheRecord<T> | undefined> {
    return undefined;
  }
  public async setSearch(): Promise<boolean> {
    return true;
  }
  public async getContent<T>(): Promise<CacheRecord<T> | undefined> {
    return undefined;
  }
  public async setContent(): Promise<boolean> {
    return true;
  }
  public async deleteExpired(): Promise<number> {
    return 0;
  }
  public close(): void {}
}

class ContentCache implements CacheRepository {
  public constructor(public record: CacheRecord<FetchedContent>) {}
  public async getSearch<T>(): Promise<CacheRecord<T> | undefined> {
    return undefined;
  }
  public async setSearch(): Promise<boolean> {
    return true;
  }
  public async getContent<T>(): Promise<CacheRecord<T> | undefined> {
    return this.record as CacheRecord<T>;
  }
  public async setContent<T>(_key: string, value: T): Promise<boolean> {
    this.record = { ...this.record, value: value as FetchedContent, stale: false };
    return true;
  }
  public async deleteExpired(): Promise<number> {
    return 0;
  }
  public close(): void {}
}

describe('FetchUrl', () => {
  it('selects content and preserves metadata', async () => {
    const useCase = new FetchUrl(
      {
        async fetch({ url }) {
          const value = url.value;
          return {
            requestedUrl: value,
            finalUrl: value,
            canonicalUrl: value,
            title: 'Documentation',
            markdown: '# Intro\n\nOther.\n\n## Cache\n\nSQLite cache transactions.',
            documentSections: [],
            contentType: 'text/html',
            fetchedAt: '2026-06-20T00:00:00.000Z',
            extractionMode: 'static' as const,
            statusCode: 200,
            contentHash: 'hash',
            metadata: { language: 'en' },
            links: ['https://example.com/next'],
          };
        },
      },
      new NoCache(),
      {
        async assertAllowed(url) {
          return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
        },
      },
      { findByUrl: () => undefined, findForQuery: () => [], list: () => [], version: () => '1' },
      testOptions(),
    );

    const response = await useCase.execute({
      url: 'https://example.com/docs',
      query: 'SQLite cache',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });

    expect(response.data.markdown).toContain('## Cache');
    expect(response.data.markdown).not.toContain('# Intro');
    expect(response.data.fetchedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(response.data.sectionCount).toBe(1);
    expect(response.cacheStatus).toBe('MISS');
  });

  it('filters blocked links and never exposes provider metadata', async () => {
    const useCase = new FetchUrl(
      {
        async fetch({ url }) {
          const value = url.value;
          return {
            requestedUrl: value,
            finalUrl: value,
            canonicalUrl: value,
            markdown: '# Safe\n\nPublic documentation content.',
            documentSections: [],
            contentType: 'text/html',
            fetchedAt: '2026-06-21T00:00:00.000Z',
            extractionMode: 'static',
            statusCode: 200,
            contentHash: 'hash',
            metadata: { secret: 'must-not-leak' },
            links: ['https://example.com/ok', 'http://127.0.0.1/private'],
          };
        },
      },
      new NoCache(),
      {
        async assertAllowed(url) {
          if (url.includes('127.0.0.1')) throw new Error('blocked');
          return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
        },
      },
      { findByUrl: () => undefined, findForQuery: () => [], list: () => [], version: () => '1' },
      testOptions(),
    );
    const response = await useCase.execute({
      url: 'https://example.com',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });
    expect(response.data.links).toEqual(['https://example.com/ok']);
    expect(JSON.stringify(response.data)).not.toContain('must-not-leak');
  });

  it('reports a validated redirect and controlled native-render fallback', async () => {
    const content = {
      ...fetchedContent(),
      finalUrl: 'https://www.example.com/docs',
      canonicalUrl: 'https://www.example.com/docs',
      extractionMode: 'native-render' as const,
    };
    const useCase = createCachedUseCase(new NoCache(), async () => content);
    const response = await useCase.execute({
      url: 'https://example.com/docs',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'auto',
    });
    expect(response.data.finalUrl).toBe('https://www.example.com/docs');
    expect(response.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['REDIRECTED_URL', 'JAVASCRIPT_FALLBACK_USED']),
    );
  });

  it('uses stale content when the provider is unavailable', async () => {
    const content = fetchedContent();
    const cache = new ContentCache({
      value: content,
      createdAt: new Date(0),
      expiresAt: new Date(1),
      stale: true,
      etag: '"v1"',
      contentHash: content.contentHash,
    });
    const useCase = createCachedUseCase(cache, async () => {
      throw new ExternalServiceError('down', 'crawl4ai');
    });
    const response = await useCase.execute({
      url: content.requestedUrl,
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });
    expect(response.cacheStatus).toBe('STALE_FALLBACK');
    expect(response.status).toBe('partial');
    expect(response.warnings.map((warning) => warning.code)).toContain('STALE_CACHE_USED');
  });

  it('revalidates stale content with HTTP validators', async () => {
    const content = fetchedContent();
    const cache = new ContentCache({
      value: content,
      createdAt: new Date(0),
      expiresAt: new Date(1),
      stale: true,
      etag: '"v1"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      contentHash: content.contentHash,
    });
    let received: unknown;
    const useCase = createCachedUseCase(cache, async (_request, context) => {
      received = context?.cacheValidators;
      return { notModified: true as const };
    });
    const response = await useCase.execute({
      url: content.requestedUrl,
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });
    expect(received).toMatchObject({ etag: '"v1"', contentHash: content.contentHash });
    expect(response.cacheStatus).toBe('HIT');
    expect(cache.record.stale).toBe(false);
  });

  it('reports DISABLED when configured without cache', async () => {
    const useCase = createCachedUseCase(new DisabledCacheRepository(), async () =>
      fetchedContent(),
    );
    const response = await useCase.execute({
      url: 'https://example.com/docs',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });
    expect(response.cacheStatus).toBe('DISABLED');
  });

  it('emits correlated fetch and truncation events', async () => {
    const events: { event: string; data?: Readonly<Record<string, unknown>> }[] = [];
    const content = { ...fetchedContent(), markdown: `# Docs\n\n${'content '.repeat(1_000)}` };
    const useCase = createCachedUseCase(new DisabledCacheRepository(), async () => content, {
      record: (event, data) => events.push({ event, ...(data === undefined ? {} : { data }) }),
    });
    await useCase.execute(
      { url: content.requestedUrl, maxCharacters: 1_000, maxSections: 5, renderMode: 'static' },
      { requestId: 'request-fetch' },
    );
    expect(events.map(({ event }) => event)).toEqual([
      'cache_miss',
      'provider_called',
      'content_truncated',
    ]);
    expect(events.every(({ data }) => data?.['requestId'] === 'request-fetch')).toBe(true);
  });
});

function fetchedContent(): FetchedContent {
  return {
    requestedUrl: 'https://example.com/docs',
    finalUrl: 'https://example.com/docs',
    canonicalUrl: 'https://example.com/docs',
    title: 'Docs',
    markdown: '# Docs\n\nPublic cached documentation.',
    contentType: 'text/html',
    documentSections: [{ heading: 'Docs', markdown: '# Docs\n\nPublic cached documentation.' }],
    fetchedAt: '2026-06-21T00:00:00.000Z',
    extractionMode: 'static',
    statusCode: 200,
    etag: '"v1"',
    contentHash: 'abc',
    metadata: {},
    links: [],
  };
}

function createCachedUseCase(
  cache: CacheRepository,
  fetch: ConstructorParameters<typeof FetchUrl>[0]['fetch'],
  telemetry?: ConstructorParameters<typeof FetchUrl>[5],
): FetchUrl {
  return new FetchUrl(
    { fetch },
    cache,
    {
      async assertAllowed(url) {
        return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
      },
    },
    { findByUrl: () => undefined, findForQuery: () => [], list: () => [], version: () => '1' },
    {
      ...testOptions(),
      documentationTtlMs: 86_400_000,
      readmeTtlMs: 21_600_000,
      sitemapTtlMs: 86_400_000,
    },
    telemetry,
  );
}

function testOptions() {
  return {
    documentationTtlMs: 1_000,
    readmeTtlMs: 1_000,
    sitemapTtlMs: 1_000,
    maxLinks: 10,
    timeoutMs: 1_000,
    maxResponseBytes: 1_000_000,
    maxRedirects: 5,
  } as const;
}
