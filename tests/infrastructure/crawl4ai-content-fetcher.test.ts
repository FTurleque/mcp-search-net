import { describe, expect, it, vi } from 'vitest';

import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';

describe('Crawl4aiContentFetcher', () => {
  it('uses the hardened minimal request and maps Crawl4AI 0.9 results', async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            results: [
              {
                url: 'https://example.com',
                redirected_url: 'https://example.com/',
                success: true,
                markdown: {
                  raw_markdown: '# Example\n\n[Link](https://example.net)',
                  markdown_with_citations: '# Example\n\nLink⟨1⟩',
                },
                metadata: { title: 'Example' },
                response_headers: { 'content-type': 'text/html' },
                links: { external: [{ href: 'https://example.net' }] },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher(
      'http://127.0.0.1:11235',
      1_000,
      '0123456789abcdef',
      fetchMock,
    );

    const result = await fetcher.fetch('https://example.com');

    const request = vi.mocked(fetchMock).mock.calls[0];
    const requestBody = request?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(requestBody)).toEqual({ urls: ['https://example.com'] });
    expect(new Headers(request?.[1]?.headers).get('authorization')).toBe('Bearer 0123456789abcdef');
    expect(result).toMatchObject({
      title: 'Example',
      resolvedUrl: 'https://example.com/',
      markdown: '# Example\n\n[Link](https://example.net)',
      contentType: 'text/html',
      links: ['https://example.net'],
    });
  });
});
