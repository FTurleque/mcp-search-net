import { describe, expect, it } from 'vitest';

import type {
  CacheGetOptions,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../src/application/ports/cache-repository.js';
import { FetchUrl } from '../../src/application/use-cases/fetch-url.js';
import type { FetchedContent } from '../../src/domain/models/content.js';

class RevalidationCache implements CacheRepository {
  public stored: FetchedContent | undefined;

  public constructor(private readonly record: CacheRecord<FetchedContent>) {}

  public async getSearch<T>(): Promise<CacheRecord<T> | undefined> {
    return undefined;
  }

  public async setSearch<T>(
    _key: string,
    _value: T,
    _ttlMs: number,
    _validators?: CacheValidators,
  ): Promise<boolean> {
    return true;
  }

  public async getContent<T>(
    _key: string,
    _options?: CacheGetOptions<T>,
  ): Promise<CacheRecord<T> | undefined> {
    return this.record as unknown as CacheRecord<T>;
  }

  public async setContent<T>(
    _key: string,
    value: T,
    _ttlMs: number,
    _validators?: CacheValidators,
  ): Promise<boolean> {
    this.stored = value as unknown as FetchedContent;
    return true;
  }

  public async deleteExpired(): Promise<number> {
    return 0;
  }

  public close(): void {}
}

describe('FetchUrl 304 redirect revalidation', () => {
  it('keeps cached content while adopting a fresh permanent redirect target', async () => {
    const oldUrl = 'https://example.com/old-doc';
    const newUrl = 'https://example.com/new-doc';
    const cachedContent: FetchedContent = {
      requestedUrl: oldUrl,
      finalUrl: oldUrl,
      canonicalUrl: oldUrl,
      title: 'Cached docs',
      markdown: '# Cached docs\n\nStill current.',
      documentSections: [{ heading: 'Cached docs', markdown: '# Cached docs\n\nStill current.' }],
      contentType: 'text/html',
      fetchedAt: '2026-08-01T00:00:00.000Z',
      extractionMode: 'static',
      statusCode: 200,
      etag: '"v1"',
      contentHash: 'hash-v1',
      redirectChain: [],
      metadata: {},
      links: [],
    };
    const cache = new RevalidationCache({
      value: cachedContent,
      createdAt: new Date(0),
      expiresAt: new Date(1),
      stale: true,
      etag: '"v1"',
      contentHash: cachedContent.contentHash,
    });
    const useCase = new FetchUrl(
      {
        async fetch() {
          return {
            notModified: true as const,
            requestedUrl: oldUrl,
            finalUrl: newUrl,
            redirectChain: [
              {
                fromUrl: oldUrl,
                toUrl: newUrl,
                status: 301,
                permanent: true,
              },
            ],
          };
        },
      },
      cache,
      {
        async assertAllowed(value) {
          const url = new URL(value);
          return {
            value: url.toString(),
            hostname: url.hostname,
            addresses: ['93.184.216.34'],
          };
        },
      },
      {
        findByUrl: () => undefined,
        findForQuery: () => [],
        list: () => [],
        version: () => '1',
      },
      {
        documentationTtlMs: 86_400_000,
        readmeTtlMs: 21_600_000,
        sitemapTtlMs: 86_400_000,
        maxLinks: 10,
        timeoutMs: 1_000,
        maxResponseBytes: 1_000_000,
        maxRedirects: 5,
      },
    );

    const response = await useCase.execute({
      url: oldUrl,
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });

    expect(response.cacheStatus).toBe('HIT');
    expect(response.data).toMatchObject({
      finalUrl: newUrl,
      canonicalUrl: newUrl,
      markdown: '# Cached docs\n\nStill current.',
    });
    expect(response.warnings.map((warning) => warning.code)).toContain('REDIRECTED_URL');
    expect(cache.stored).toMatchObject({
      finalUrl: newUrl,
      canonicalUrl: newUrl,
      markdown: cachedContent.markdown,
      redirectChain: [
        {
          fromUrl: oldUrl,
          toUrl: newUrl,
          status: 301,
          permanent: true,
        },
      ],
    });
  });
});
