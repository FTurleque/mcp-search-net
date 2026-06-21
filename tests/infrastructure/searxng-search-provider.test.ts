import { describe, expect, it, vi } from 'vitest';

import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';

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
              },
            ],
            unresponsive_engines: [['google', 'timeout']],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    const response = await provider.search({ query: 'mcp sdk', language: 'fr', limit: 5 });

    const requestTarget = vi.mocked(fetchMock).mock.calls[0]?.[0];
    expect(requestTarget).toBeInstanceOf(URL);
    const requestedUrl = requestTarget as URL;
    expect(requestedUrl.pathname).toBe('/search');
    expect(requestedUrl.searchParams.get('format')).toBe('json');
    expect(requestedUrl.searchParams.get('language')).toBe('fr');
    expect(response.results[0]).toMatchObject({
      title: 'Official docs',
      snippet: 'A & B',
      engines: ['brave', 'bing'],
    });
    expect(response.unresponsiveEngines).toEqual(['google']);
  });
});
