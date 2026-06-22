import { describe, expect, it, vi } from 'vitest';

import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';
import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';

describe('recorded provider contracts', () => {
  it('accepts missing optional and additional SearXNG fields', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ url: 'https://example.com', extra: { future: true } }],
            future_field: 1,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://searxng', 1_000, fetchMock);
    await expect(
      provider.search({ query: SearchQuery.create('docs'), maxResults: 5 }),
    ).resolves.toMatchObject({
      results: [{ title: '', url: 'https://example.com', snippet: '' }],
    });
  });

  it.each([
    [{}, 'missing results'],
    [{ results: [{ url: 42 }] }, 'invalid result URL'],
    [{ results: 'not-an-array' }, 'invalid results collection'],
  ])('rejects invalid SearXNG fixture: %s', async (fixture, _description) => {
    expect(_description).toBeTypeOf('string');
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(fixture)),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://searxng', 1_000, fetchMock);
    await expect(
      provider.search({ query: SearchQuery.create('docs'), maxResults: 5 }),
    ).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_UNAVAILABLE',
    });
  });

  it('rejects non-JSON provider responses', async () => {
    const fetchMock = vi.fn(
      async () => new Response('<html>error</html>'),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://searxng', 1_000, fetchMock);
    await expect(
      provider.search({ query: SearchQuery.create('docs'), maxResults: 5 }),
    ).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_UNAVAILABLE',
    });
  });

  it('rejects invalid and partial Crawl4AI rendering envelopes', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com',
        finalUrl: 'https://example.com',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode('<p>tiny</p>'),
      }),
    } as unknown as SecureHttpGateway;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ results: [{ success: false, unexpected: true }] })),
    ) as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway, fetchMock);
    await expect(fetcher.fetch(fetchRequest('https://example.com', 'auto'))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });
});

function fetchRequest(url: string, renderMode: 'static' | 'auto') {
  return {
    url: WebUrl.create(url),
    renderMode,
    timeoutMs: 1_000,
    maxResponseBytes: 1_000_000,
    maxRedirects: 5,
  } as const;
}
