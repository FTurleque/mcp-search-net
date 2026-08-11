import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CacheRecord, CacheRepository } from '../../src/application/ports/cache-repository.js';
import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import type { ContentFetcher } from '../../src/application/ports/content-fetcher.js';
import type { Logger } from '../../src/application/ports/logger.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type { SearchProvider } from '../../src/application/ports/search-provider.js';
import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { FetchUrl } from '../../src/application/use-cases/fetch-url.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import { HttpError } from '../../src/domain/errors/domain-errors.js';
import type { FetchedContent } from '../../src/domain/models/content.js';
import { selectRelevantContent } from '../../src/domain/services/content-selection.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { SafeCacheRepository } from '../../src/infrastructure/cache/safe-cache-repository.js';
import { sanitizePreparedHtml } from '../../src/infrastructure/fetch/prepared-html-sanitizer.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe('audit P2/P3 remediations', () => {
  it.each([403, 404, 410])(
    'does not use stale fetch content after permanent HTTP %i',
    async (status) => {
      const fetchUrl = createFetchUrlThatFails(status);

      await expect(
        fetchUrl.execute({
          url: 'https://example.com/doc',
          query: 'cached',
          maxCharacters: 5_000,
          maxSections: 5,
          renderMode: 'static',
        }),
      ).rejects.toMatchObject({ code: 'HTTP_ERROR', status });
    },
  );

  it.each([429, 500])('uses stale fetch content for transient HTTP %i', async (status) => {
    const fetchUrl = createFetchUrlThatFails(status);

    const result = await fetchUrl.execute({
      url: 'https://example.com/doc',
      query: 'cached',
      maxCharacters: 5_000,
      maxSections: 5,
      renderMode: 'static',
    });

    expect(result.cacheStatus).toBe('STALE_FALLBACK');
    expect(result.warnings.map((warning) => warning.code)).toContain('STALE_CACHE_USED');
    expect(result.data.markdown).toContain('cached documentation');
  });

  it('does not report relevance filtering as content truncation', () => {
    const selected = selectRelevantContent(
      '# Authentication\n\nUse a bearer authentication token.\n\n# Deployment\n\nRun Docker Compose.',
      'authentication token',
      5_000,
      5,
    );

    expect(selected.sections.map((section) => section.heading)).toEqual(['Authentication']);
    expect(selected.truncated).toBe(false);
    expect(selected.sectionTruncated).toBe(false);
  });

  it('keeps strict cache mode failing after the first operational failure', async () => {
    const setSearch = vi.fn(async () => true);
    const failing: CacheRepository = {
      async getSearch() {
        throw new Error('sqlite unavailable');
      },
      setSearch,
      async getContent() {
        return undefined;
      },
      async setContent() {
        return true;
      },
      async deleteExpired() {
        return 0;
      },
      close() {},
    };
    const cache = new SafeCacheRepository(failing, false, silentLogger());

    await expect(cache.getSearch('first')).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' });
    await expect(cache.setSearch('second', { ok: true }, 1_000)).rejects.toMatchObject({
      code: 'CACHE_UNAVAILABLE',
    });
    expect(setSearch).not.toHaveBeenCalled();
  });

  it('shares one SearXNG deadline across the retry', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(25)
      .mockReturnValue(25);
    const delayedFailure = delayedHttpFailure(25);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('failure', { status: 500 }))
      .mockImplementation(delayedFailure) as unknown as typeof fetch;
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 35, fetchMock);
    const started = performance.now();

    await expect(
      provider.search({ query: SearchQuery.create('deadline'), language: 'en', maxResults: 5 }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(performance.now() - started).toBeLessThan(80);
  });

  it('shares one search_web deadline across language fallback', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      async search() {
        calls += 1;
        if (calls === 1) {
          await delay(25);
          return { results: [], unresponsiveEngines: [] };
        }
        await delay(100);
        return { results: [], unresponsiveEngines: [] };
      },
    };
    const search = new SearchWeb(provider, new DisabledCacheRepository(), emptyOfficialRegistry(), {
      cacheTtlMs: 1_000,
      providerOversampling: 1,
      maxSnippetChars: 200,
      providerTimeoutMs: 35,
    });
    const started = performance.now();

    await expect(
      search.execute({ query: 'deadline fallback', language: 'fr-FR', maxResults: 5 }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });

    expect(calls).toBe(2);
    expect(performance.now() - started).toBeLessThan(80);
  });

  it('serializes the minimum delay for concurrent requests to the same origin', async () => {
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const gateway = new SecureHttpGateway(policyForLocalServer(port), {
      timeoutMs: 2_000,
      maxBytes: 10_000,
      maxRedirects: 2,
      maxConcurrency: 2,
      minimumDelayMs: 80,
      respectRobotsTxt: false,
      userAgent: 'mcp-search-net/1.1.0',
    });
    const started = performance.now();

    await Promise.all([
      gateway.download(`http://audit.invalid:${port}/first`),
      gateway.download(`http://audit.invalid:${port}/second`),
    ]);

    expect(requestCount).toBe(2);
    expect(performance.now() - started).toBeGreaterThanOrEqual(60);
  });

  it('removes explicit non-Web href schemes while preserving Web and relative links', () => {
    const sanitized = sanitizePreparedHtml(
      [
        '<a href="javascript:alert(1)">script</a>',
        '<a href="data:text/html,boom">data</a>',
        '<a href="https://example.com/docs">https</a>',
        '<a href="/relative">relative</a>',
      ].join(''),
    );

    expect(sanitized).toContain('<a>script</a>');
    expect(sanitized).toContain('<a>data</a>');
    expect(sanitized).toContain('href="https://example.com/docs"');
    expect(sanitized).toContain('href="/relative"');
    expect(sanitized).not.toMatch(/javascript:|data:/iu);
  });

  it('keeps workflow_dispatch values out of PowerShell source code', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/release-windows.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain('RELEASE_VERSION: ${{ inputs.version }}');
    expect(workflow).toContain('-Version $env:RELEASE_VERSION');
    expect(workflow).not.toContain("-Version '${{ inputs.version }}'");
  });

  it('keeps architecture risks aligned with the completed 3/3 certification', () => {
    const arc42 = readFileSync(
      new URL('../../docs/architecture/arc42/11-risques-dette.md', import.meta.url),
      'utf8',
    );
    const register = readFileSync(
      new URL('../../docs/architecture/risks/register.md', import.meta.url),
      'utf8',
    );

    for (const document of [arc42, register]) {
      expect(document).not.toContain('issue #34 ouverte');
      expect(document).not.toContain('cinq clients restent non certifiés');
      expect(document).toMatch(/3\/3|certifi(?:é|ée)s? 3\/3/iu);
    }
  });
});

function createFetchUrlThatFails(status: number): FetchUrl {
  const staleContent: FetchedContent = {
    requestedUrl: 'https://example.com/doc',
    finalUrl: 'https://example.com/doc',
    canonicalUrl: 'https://example.com/doc',
    title: 'Cached document',
    markdown: '# Cached\n\ncached documentation remains available',
    documentSections: [
      { heading: 'Cached', markdown: '# Cached\n\ncached documentation remains available' },
    ],
    contentType: 'text/markdown',
    fetchedAt: '2026-08-10T20:00:00.000Z',
    extractionMode: 'static',
    statusCode: 200,
    contentHash: 'cached-hash',
    redirectChain: [],
    metadata: {},
    links: [],
  };
  const record: CacheRecord<FetchedContent> = {
    value: staleContent,
    createdAt: new Date('2026-08-10T20:00:00.000Z'),
    expiresAt: new Date('2026-08-10T20:01:00.000Z'),
    stale: true,
    contentHash: staleContent.contentHash,
  };
  const cache: CacheRepository = {
    async getSearch() {
      return undefined;
    },
    async setSearch() {
      return true;
    },
    async getContent<T>() {
      return record as CacheRecord<T>;
    },
    async setContent() {
      return true;
    },
    async deleteExpired() {
      return 0;
    },
    close() {},
  };
  const fetcher: ContentFetcher = {
    async fetch() {
      throw new HttpError(`remote returned ${status}`, status);
    },
  };
  return new FetchUrl(fetcher, cache, permissivePolicy(), emptyOfficialRegistry(), {
    documentationTtlMs: 60_000,
    readmeTtlMs: 60_000,
    sitemapTtlMs: 60_000,
    maxLinks: 10,
    timeoutMs: 1_000,
    maxResponseBytes: 1_000_000,
    maxRedirects: 3,
  });
}

function permissivePolicy(): UrlSecurityPolicy {
  return {
    async assertAllowed(value) {
      const url = new URL(value);
      return { value: url.toString(), hostname: url.hostname, addresses: ['203.0.113.1'] };
    },
  };
}

function policyForLocalServer(port: number): UrlSecurityPolicy {
  return {
    async assertAllowed(value) {
      const url = new URL(value);
      url.port = String(port);
      return { value: url.toString(), hostname: url.hostname, addresses: ['127.0.0.1'] };
    },
  };
}

function emptyOfficialRegistry(): OfficialSourceRegistry {
  return {
    findByUrl() {
      return undefined;
    },
    findForQuery() {
      return [];
    },
    list() {
      return [];
    },
    version() {
      return 'test';
    },
  };
}

function silentLogger(): Logger {
  return {
    record() {},
    debug() {},
    info() {},
    warning() {},
    error() {},
  };
}

function delayedHttpFailure(milliseconds: number) {
  return (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(new Response('failure', { status: 500 })),
        milliseconds,
      );
      const signal = init?.signal;
      const abort = (): void => {
        clearTimeout(timer);
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
