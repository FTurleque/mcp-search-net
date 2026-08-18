import { describe, expect, it, vi } from 'vitest';

import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
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

  it('strips HTML-encoded tags from title and snippet without reintroducing markup', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: '&lt;b&gt;Official docs&lt;/b&gt;',
                url: 'https://docs.example.com/',
                content: '&lt;em&gt;&lt;b&gt;Nested&lt;/b&gt;&lt;/em&gt; content',
              },
            ],
            unresponsive_engines: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    const response = await provider.search({
      query: SearchQuery.create('test'),
      maxResults: 5,
    });

    expect(response.results[0]?.title).toBe('Official docs');
    expect(response.results[0]?.snippet).toBe('Nested content');
    expect(response.results[0]?.title).not.toMatch(/<[^>]+>/);
    expect(response.results[0]?.snippet).not.toMatch(/<[^>]+>/);
  });

  it.each([
    ['Fran&#231;ais', 'Français'],
    ['Fran&#xE7;ais', 'Français'],
    ['A &amp; B', 'A & B'],
    ['&lt;b&gt;Official&lt;/b&gt;', 'Official'],
    ['&#0; invalid', '\uFFFD invalid'],
  ])('decodes snippet %s → %s', async (raw, expected) => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ title: raw, url: 'https://example.com/', content: '' }],
            unresponsive_engines: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    const response = await provider.search({ query: SearchQuery.create('xx'), maxResults: 5 });
    expect(response.results[0]?.title).toBe(expected);
  });

  it('aborts the HTTP request at an earlier search_web operation deadline', async () => {
    vi.useFakeTimers();
    try {
      let receivedSignal: AbortSignal | undefined;
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            receivedSignal = init?.signal ?? undefined;
            receivedSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ) as unknown as typeof fetch;
      const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 10_000, fetchMock);
      const deadlineMs = Date.now() + 50;

      const search = provider.search({
        query: SearchQuery.create('mcp sdk'),
        maxResults: 5,
        deadlineMs,
      });
      const assertion = expect(search).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(60);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [403, 1],
    [404, 1],
    [410, 1],
    [408, 2],
    [425, 2],
    [429, 2],
    [500, 2],
    [503, 2],
  ])('maps HTTP %i and retries at most once when temporary', async (status, expectedCalls) => {
    const fetchMock = vi.fn(
      async () => new Response('failure', { status }),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    await expect(
      provider.search({ query: SearchQuery.create('mcp sdk'), maxResults: 5 }),
    ).rejects.toMatchObject({ code: 'SEARCH_PROVIDER_UNAVAILABLE', status });
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
  });
});
