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
  public storedValidators: CacheValidators | undefined;

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
    validators?: CacheValidators,
  ): Promise<boolean> {
    this.stored = value as unknown as FetchedContent;
    this.storedValidators = validators;
    return true;
  }

  public async deleteExpired(): Promise<number> {
    return 0;
  }

  public close(): void {}
}

describe('FetchUrl 304 redirect revalidation', () => {
  it('keeps cached content while adopting a fresh permanent redirect target and validators', async () => {
    const oldUrl = 'https://example.com/old-doc';
    const newUrl = 'https://example.com/new-doc';
    const cachedContent = createCachedContent(oldUrl);
    const cache = createCache(cachedContent, oldUrl);
    const useCase = createUseCase(cache, async () => ({
      notModified: true as const,
      requestedUrl: oldUrl,
      finalUrl: newUrl,
      etag: '"v2"',
      lastModified: 'Wed, 12 Aug 2026 08:00:00 GMT',
      redirectChain: [
        {
          fromUrl: oldUrl,
          toUrl: newUrl,
          status: 301,
          permanent: true,
        },
      ],
    }));

    const response = await execute(useCase, oldUrl);

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
      etag: '"v2"',
      lastModified: 'Wed, 12 Aug 2026 08:00:00 GMT',
    });
    expect(cache.stored?.metadata).toMatchObject({
      etag: '"v2"',
      lastModified: 'Wed, 12 Aug 2026 08:00:00 GMT',
      redirectedPermanently: true,
    });
    expect(cache.storedValidators).toEqual({
      etag: '"v2"',
      lastModified: 'Wed, 12 Aug 2026 08:00:00 GMT',
      contentHash: cachedContent.contentHash,
      validatorUrl: newUrl,
    });
  });

  it('stops canonical promotion at the first temporary redirect in a mixed chain', async () => {
    const oldUrl = 'https://example.com/old-doc';
    const permanentUrl = 'https://example.com/new-doc';
    const temporaryUrl = 'https://example.com/preview-doc';
    const cachedContent = createCachedContent(oldUrl);
    const cache = createCache(cachedContent, oldUrl);
    const useCase = createUseCase(cache, async () => ({
      notModified: true as const,
      requestedUrl: oldUrl,
      finalUrl: temporaryUrl,
      redirectChain: [
        {
          fromUrl: oldUrl,
          toUrl: permanentUrl,
          status: 301,
          permanent: true,
        },
        {
          fromUrl: permanentUrl,
          toUrl: temporaryUrl,
          status: 302,
          permanent: false,
        },
      ],
    }));

    const response = await execute(useCase, oldUrl);

    expect(response.data.finalUrl).toBe(temporaryUrl);
    expect(response.data.canonicalUrl).toBe(permanentUrl);
    expect(cache.stored).toMatchObject({
      finalUrl: temporaryUrl,
      canonicalUrl: permanentUrl,
    });
  });

  it('does not treat a permanent redirect after a temporary hop as permanent for the original URL', async () => {
    const oldUrl = 'https://example.com/old-doc';
    const temporaryUrl = 'https://example.com/preview-doc';
    const finalUrl = 'https://example.com/final-doc';
    const cachedContent = createCachedContent(oldUrl);
    const cache = createCache(cachedContent, oldUrl);
    const useCase = createUseCase(cache, async () => ({
      notModified: true as const,
      requestedUrl: oldUrl,
      finalUrl,
      redirectChain: [
        {
          fromUrl: oldUrl,
          toUrl: temporaryUrl,
          status: 302,
          permanent: false,
        },
        {
          fromUrl: temporaryUrl,
          toUrl: finalUrl,
          status: 301,
          permanent: true,
        },
      ],
    }));

    const response = await execute(useCase, oldUrl);

    expect(response.data.finalUrl).toBe(finalUrl);
    expect(response.data.canonicalUrl).toBe(oldUrl);
    expect(cache.stored?.canonicalUrl).toBe(oldUrl);
  });
});

function createCachedContent(url: string): FetchedContent {
  return {
    requestedUrl: url,
    finalUrl: url,
    canonicalUrl: url,
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
    metadata: { etag: '"v1"' },
    links: [],
  };
}

function createCache(content: FetchedContent, validatorUrl: string): RevalidationCache {
  return new RevalidationCache({
    value: content,
    createdAt: new Date(0),
    expiresAt: new Date(1),
    stale: true,
    etag: '"v1"',
    contentHash: content.contentHash,
    validatorUrl,
  });
}

function createUseCase(
  cache: RevalidationCache,
  fetch: () => ReturnType<Parameters<typeof createUseCase>[1]>,
): FetchUrl {
  return new FetchUrl(
    { fetch },
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
}

async function execute(useCase: FetchUrl, url: string) {
  return useCase.execute({
    url,
    maxCharacters: 2_000,
    maxSections: 5,
    renderMode: 'static',
  });
}
