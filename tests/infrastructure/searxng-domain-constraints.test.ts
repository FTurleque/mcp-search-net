import { describe, expect, it, vi } from 'vitest';

import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';

describe('SearxngSearchProvider domain constraints', () => {
  it('adds bounded site filters to the provider query', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [], unresponsive_engines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 1_000, fetchMock);

    await provider.search({
      query: SearchQuery.create('mcp sdk'),
      domainConstraints: ['docs.example.com', 'github.com', 'docs.example.com'],
      maxResults: 5,
    });

    const requestTarget = vi.mocked(fetchMock).mock.calls[0]?.[0] as URL;
    expect(requestTarget.searchParams.get('q')).toBe(
      'mcp sdk (site:docs.example.com OR site:github.com)',
    );
  });
});
