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
      domainConstraints: [
        { domain: 'docs.example.com' },
        { domain: 'github.com' },
        { domain: 'docs.example.com' },
      ],
      maxResults: 5,
    });

    const requestTarget = vi.mocked(fetchMock).mock.calls[0]?.[0] as URL;
    expect(requestTarget.searchParams.get('q')).toBe(
      'mcp sdk (site:docs.example.com OR site:github.com)',
    );
  });

  it('scopes a GitHub-style constraint to its organization/repository path prefix', async () => {
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
      domainConstraints: [
        { domain: 'github.com', pathPrefix: '/modelcontextprotocol/typescript-sdk' },
      ],
      maxResults: 5,
    });

    const requestTarget = vi.mocked(fetchMock).mock.calls[0]?.[0] as URL;
    expect(requestTarget.searchParams.get('q')).toBe(
      'mcp sdk (site:github.com/modelcontextprotocol/typescript-sdk)',
    );
  });

  it('falls back to a bare domain filter when the path prefix contains unsafe characters', async () => {
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
      domainConstraints: [{ domain: 'github.com', pathPrefix: '/foo bar"; DROP' }],
      maxResults: 5,
    });

    const requestTarget = vi.mocked(fetchMock).mock.calls[0]?.[0] as URL;
    expect(requestTarget.searchParams.get('q')).toBe('mcp sdk (site:github.com)');
  });
});
