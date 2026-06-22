import { describe, expect, it, vi } from 'vitest';

import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';

describe('SearxngSearchProvider', () => {
  it('requests JSON explicitly and tolerates engine metadata', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            number_of_results: 1,
            results: [
              {
                title: '<b>Official docs</b>',
                url: 'https://docs.example.com/',
                content: 'A &amp; B',
                engines: ['brave', 'bing'],
                score: 4.2,
                publishedDate: null,
                updatedDate: '2026-06-20T12:00:00Z',
                language: 'en',
              },
            ],
            unresponsive_engines: [['google', 'timeout']],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    const response = await provider.search({
      query: SearchQuery.create('mcp sdk'),
      language: 'fr-FR',
      timeRange: 'month',
      maxResults: 5,
    });

    const requestTarget = vi.mocked(fetchMock).mock.calls[0]?.[0];
    expect(requestTarget).toBeInstanceOf(URL);
    const requestedUrl = requestTarget as URL;
    expect(requestedUrl.pathname).toBe('/search');
    expect(requestedUrl.searchParams.get('format')).toBe('json');
    expect(requestedUrl.searchParams.get('language')).toBe('fr-FR');
    expect(requestedUrl.searchParams.get('time_range')).toBe('month');
    expect(requestedUrl.searchParams.get('pageno')).toBe('1');
    expect(response.results[0]).toMatchObject({
      title: 'Official docs',
      snippet: 'A & B',
      engines: ['brave', 'bing'],
      updatedAt: '2026-06-20T12:00:00.000Z',
      detectedLanguage: 'en',
    });
    expect(response.unresponsiveEngines).toEqual(['google']);
  });

  it.each([
    [403, 1],
    [429, 2],
    [500, 2],
  ])('maps HTTP %i and retries at most once when temporary', async (status, expectedCalls) => {
    const fetchMock = vi.fn(
      async () => new Response('failure', { status }),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    await expect(
      provider.search({ query: SearchQuery.create('mcp sdk'), maxResults: 5 }),
    ).rejects.toMatchObject({ code: 'SEARCH_PROVIDER_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
  });
});
