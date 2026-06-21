import { describe, expect, it } from 'vitest';

import type { CacheRecord, CacheRepository } from '../../src/application/ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type { SearchProvider } from '../../src/application/ports/search-provider.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import type { OfficialSource } from '../../src/domain/models/official-source.js';
import type { ProviderSearchResult, SearchRequest } from '../../src/domain/models/search.js';

class MemoryCache implements CacheRepository {
  private readonly values = new Map<string, unknown>();
  public async get<T>(namespace: string, key: string): Promise<CacheRecord<T> | undefined> {
    const value = this.values.get(`${namespace}:${key}`) as T | undefined;
    return value === undefined
      ? undefined
      : { value, createdAt: new Date(0), expiresAt: new Date(999_999_999_999) };
  }
  public async set<T>(namespace: string, key: string, value: T): Promise<void> {
    this.values.set(`${namespace}:${key}`, value);
  }
  public async delete(): Promise<void> {}
  public async prune(): Promise<number> {
    return 0;
  }
  public close(): void {}
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
  },
  {
    title: 'Official MCP documentation',
    url: 'https://docs.example.com/mcp',
    snippet: 'y',
    score: 1,
    engines: ['b'],
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
      sourcePolicy: 'strict',
      allowedDomains: ['vendor.test'],
      excludedDomains: ['blocked.vendor.test'],
    });

    expect(response.data.results).toHaveLength(1);
    expect(response.data.results[0]).toMatchObject({
      domain: 'guide.vendor.test',
      sourceStatus: 'VERIFIED_OFFICIAL',
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
});

function createUseCase(search: SearchProvider['search']): SearchWeb {
  return new SearchWeb({ search }, new MemoryCache(), registry, {
    cacheTtlMs: 1_000,
    providerOversampling: 3,
    maxSnippetChars: 500,
  });
}

function providerResult(url: string): ProviderSearchResult {
  return { title: 'MCP documentation', url, snippet: 'MCP', score: 1, engines: ['test'] };
}
