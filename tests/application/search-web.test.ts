import { describe, expect, it } from 'vitest';

import type { CacheRecord, CacheRepository } from '../../src/application/ports/cache-repository.js';
import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type { SearchProvider } from '../../src/application/ports/search-provider.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import type { OfficialSource } from '../../src/domain/models/official-source.js';
import type { ProviderSearchResult, SearchRequest } from '../../src/domain/models/search.js';
import { ExternalServiceError } from '../../src/domain/errors/domain-errors.js';

class MemoryCache implements CacheRepository {
  private readonly values = new Map<string, unknown>();
  private stale = false;
  public async get<T>(
    namespace: string,
    key: string,
    options?: { allowStale?: boolean },
  ): Promise<CacheRecord<T> | undefined> {
    const value = this.values.get(`${namespace}:${key}`) as T | undefined;
    if (this.stale && options?.allowStale !== true) return undefined;
    return value === undefined
      ? undefined
      : { value, createdAt: new Date(0), expiresAt: new Date(999_999_999_999), stale: this.stale };
  }
  public async set<T>(namespace: string, key: string, value: T): Promise<void> {
    this.values.set(`${namespace}:${key}`, value);
  }
  public async delete(): Promise<void> {}
  public async prune(): Promise<number> {
    return 0;
  }
  public close(): void {}
  public markStale(): void {
    this.stale = true;
  }
}

const official: OfficialSource = {
  id: 'docs',
  name: 'Docs',
  domain: 'docs.example.com',
  baseUrl: 'https://docs.example.com/',
  includeSubdomains: true,
  githubOrganizations: [],
  keywords: ['mcp'],
  priority: 100,
  enabled: true,
};

const registry: OfficialSourceRegistry = {
  findByUrl: (url) => (url.includes('docs.example.com') ? official : undefined),
  findForQuery: () => [],
  list: () => [official],
  version: () => '1',
};

const baseResults: readonly ProviderSearchResult[] = [
  {
    title: 'Community',
    url: 'https://medium.com/mcp',
    snippet: 'x',
    score: 10,
    engines: ['a'],
    updatedAt: '2026-06-22T00:00:00.000Z',
  },
  {
    title: 'Official MCP documentation',
    url: 'https://docs.example.com/mcp',
    snippet: 'y',
    score: 1,
    engines: ['b'],
    updatedAt: '2026-06-22T00:00:00.000Z',
  },
];

const baseRequest: SearchRequest = {
  query: 'mcp',
  language: 'fr-FR',
  maxResults: 5,
  sourcePolicy: 'prefer',
  allowedDomains: [],
  excludedDomains: [],
};

describe('SearchWeb', () => {
  it('returns verified results first, emits the prefer warning and caches the response', async () => {
    let calls = 0;
    const useCase = createUseCase(async () => {
      calls += 1;
      return { results: baseResults, total: 2, unresponsiveEngines: [] };
    });

    const first = await useCase.execute(baseRequest);
    const second = await useCase.execute(baseRequest);

    expect(first.data.results[0]?.sourceStatus).toBe('VERIFIED_OFFICIAL');
    expect(first.warnings.map((warning) => warning.code)).toContain(
      'NON_OFFICIAL_RESULTS_INCLUDED',
    );
    expect(first.cacheStatus).toBe('MISS');
    expect(second.cacheStatus).toBe('HIT');
    expect(calls).toBe(1);
  });

  it.each([
    ['strict', ['VERIFIED_OFFICIAL'], []],
    ['prefer', ['VERIFIED_OFFICIAL', 'THIRD_PARTY'], ['NON_OFFICIAL_RESULTS_INCLUDED']],
    ['any', ['VERIFIED_OFFICIAL', 'THIRD_PARTY'], []],
  ] as const)('applies the %s source policy', async (sourcePolicy, statuses, warningCodes) => {
    const useCase = createUseCase(async () => ({
      results: baseResults,
      total: 2,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, sourcePolicy });

    expect(response.data.results.map((result) => result.sourceStatus)).toEqual(statuses);
    expect(response.warnings.map((warning) => warning.code)).toEqual(warningCodes);
  });

  it('returns a successful empty strict response with a specific warning', async () => {
    const useCase = createUseCase(async () => ({
      results: [baseResults[0]!],
      total: 1,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, sourcePolicy: 'strict' });

    expect(response.status).toBe('success');
    expect(response.data.results).toEqual([]);
    expect(response.warnings.map((warning) => warning.code)).toEqual([
      'NO_VERIFIED_OFFICIAL_SOURCE',
    ]);
  });

  it('applies allowed domains as a whitelist and exclusions first', async () => {
    const useCase = createUseCase(async () => ({
      results: [
        providerResult('https://guide.vendor.test/mcp'),
        providerResult('https://blocked.vendor.test/mcp'),
        providerResult('https://elsewhere.test/mcp'),
      ],
      total: 3,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({
      ...baseRequest,
      sourcePolicy: 'any',
      allowedDomains: ['vendor.test'],
      excludedDomains: ['blocked.vendor.test'],
    });

    expect(response.data.results).toHaveLength(1);
    expect(response.data.results[0]).toMatchObject({
      domain: 'guide.vendor.test',
      sourceStatus: 'UNKNOWN',
    });
  });

  it('falls back to English only when the requested language has no result', async () => {
    const languages: (string | undefined)[] = [];
    const useCase = createUseCase(async (request) => {
      languages.push(request.language);
      return request.language === 'en'
        ? { results: [baseResults[1]!], total: 1, unresponsiveEngines: [] }
        : { results: [], total: 0, unresponsiveEngines: ['engine-fr'] };
    });

    const response = await useCase.execute(baseRequest);

    expect(languages).toEqual(['fr-FR', 'en']);
    expect(response.status).toBe('partial');
    expect(response.warnings.map((warning) => warning.code)).toContain('FALLBACK_LANGUAGE_USED');
    expect(response.data.metadata.unresponsiveEngines).toEqual(['engine-fr']);
    expect(response.warnings.map((warning) => warning.code)).toContain(
      'SEARCH_PROVIDER_PARTIAL_FAILURE',
    );
  });

  it('reports when provider results do not contain freshness metadata', async () => {
    const undated = {
      title: baseResults[1]!.title,
      url: baseResults[1]!.url,
      snippet: baseResults[1]!.snippet,
      score: 1,
      engines: baseResults[1]!.engines,
    };
    const useCase = createUseCase(async () => ({
      results: [undated],
      total: 1,
      unresponsiveEngines: [],
    }));
    const response = await useCase.execute(baseRequest);
    expect(response.status).toBe('partial');
    expect(response.warnings.map((warning) => warning.code)).toContain('DATE_UNAVAILABLE');
  });

  it('warns when ranked results are truncated to maxResults', async () => {
    const useCase = createUseCase(async () => ({
      results: [providerResult('https://a.test/docs'), providerResult('https://b.test/docs')],
      total: 2,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, sourcePolicy: 'any', maxResults: 1 });

    expect(response.data.results).toHaveLength(1);
    expect(response.status).toBe('partial');
    expect(response.warnings.map((warning) => warning.code)).toContain('RESULTS_TRUNCATED');
  });

  it('uses an expired value when SearXNG is unavailable', async () => {
    const cache = new MemoryCache();
    const warm = new SearchWeb(
      { search: async () => ({ results: baseResults, total: 2, unresponsiveEngines: [] }) },
      cache,
      registry,
      { cacheTtlMs: 1, providerOversampling: 3, maxSnippetChars: 500 },
    );
    await warm.execute(baseRequest);
    cache.markStale();
    const degraded = new SearchWeb(
      {
        search: async () => {
          throw new ExternalServiceError('down', 'searxng');
        },
      },
      cache,
      registry,
      { cacheTtlMs: 1, providerOversampling: 3, maxSnippetChars: 500 },
    );
    const response = await degraded.execute(baseRequest);
    expect(response.cacheStatus).toBe('STALE_FALLBACK');
    expect(response.status).toBe('partial');
    expect(response.warnings.map((warning) => warning.code)).toContain('STALE_CACHE_USED');
  });

  it('reports DISABLED when configured without cache', async () => {
    const events: { event: string; data?: Readonly<Record<string, unknown>> }[] = [];
    const useCase = new SearchWeb(
      { search: async () => ({ results: baseResults, total: 2, unresponsiveEngines: [] }) },
      new DisabledCacheRepository(),
      registry,
      { cacheTtlMs: 1_000, providerOversampling: 3, maxSnippetChars: 500 },
      { record: (event, data) => events.push({ event, ...(data === undefined ? {} : { data }) }) },
    );
    await expect(
      useCase.execute(baseRequest, { requestId: 'request-search' }),
    ).resolves.toMatchObject({ cacheStatus: 'DISABLED' });
    expect(events.map(({ event }) => event)).toEqual(['cache_miss', 'search_provider_called']);
    expect(events.every(({ data }) => data?.['requestId'] === 'request-search')).toBe(true);
  });
});

function createUseCase(search: SearchProvider['search']): SearchWeb {
  return new SearchWeb({ search }, new MemoryCache(), registry, {
    cacheTtlMs: 1_000,
    providerOversampling: 3,
    maxSnippetChars: 500,
  });
}

function providerResult(url: string): ProviderSearchResult {
  return {
    title: 'MCP documentation',
    url,
    snippet: 'MCP',
    score: 1,
    engines: ['test'],
    updatedAt: '2026-06-22T00:00:00.000Z',
  };
}
