import { describe, expect, it, vi } from 'vitest';

import { fetchJson } from '../../src/infrastructure/http/http-utils.js';

describe('fetchJson stable errors', () => {
  it('maps non-success HTTP responses', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));

    await expect(
      fetchJson('searxng', new URL('https://example.com'), {}, 1_000, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 });
  });

  it('maps network failures to the provider-specific code', async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new Error('socket closed')));

    await expect(
      fetchJson('searxng', new URL('https://example.com'), {}, 1_000, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'SEARCH_PROVIDER_UNAVAILABLE' });
  });

  it('maps aborts to REQUEST_TIMEOUT', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    await expect(
      fetchJson('crawl4ai', new URL('https://example.com'), {}, 1, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('rejects provider JSON responses above the configured byte budget', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"value":"too-large"}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': '21' },
        }),
    );

    await expect(
      fetchJson('searxng', new URL('https://example.com'), {}, 1_000, fetchMock as typeof fetch, 8),
    ).rejects.toMatchObject({ code: 'SEARCH_PROVIDER_UNAVAILABLE' });
  });
});
