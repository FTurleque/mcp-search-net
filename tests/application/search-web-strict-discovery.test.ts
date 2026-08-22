import { describe, expect, it } from 'vitest';

import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type { SearchProviderRequest } from '../../src/application/ports/search-provider.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import type { OfficialSource } from '../../src/domain/models/official-source.js';
import type { ProviderSearchResult, SearchRequest } from '../../src/domain/models/search.js';

const primary: OfficialSource = {
  id: 'primary',
  name: 'Primary docs',
  domain: 'docs.primary.test',
  baseUrl: 'https://docs.primary.test/',
  includeSubdomains: true,
  githubOrganizations: [],
  keywords: ['mcp'],
  priority: 100,
  enabled: true,
};
const secondary: OfficialSource = {
  id: 'secondary',
  name: 'Secondary docs',
  domain: 'docs.secondary.test',
  baseUrl: 'https://docs.secondary.test/',
  includeSubdomains: true,
  githubOrganizations: [],
  keywords: ['secondary'],
  priority: 50,
  enabled: true,
};
const githubSdk: OfficialSource = {
  id: 'github-sdk',
  name: 'MCP TypeScript SDK',
  domain: 'github.com',
  baseUrl: 'https://github.com/modelcontextprotocol/typescript-sdk',
  pathPrefix: '/modelcontextprotocol/typescript-sdk',
  includeSubdomains: false,
  githubOrganizations: ['modelcontextprotocol'],
  keywords: ['typescript sdk'],
  priority: 95,
  enabled: true,
};

const allSources = [primary, secondary, githubSdk];

function registry(sources: readonly OfficialSource[] = allSources): OfficialSourceRegistry {
  return {
    findByUrl: (url) => {
      if (url.startsWith('https://docs.primary.test')) {
        return sources.find((source) => source.id === 'primary');
      }
      if (url.startsWith('https://docs.secondary.test')) {
        return sources.find((source) => source.id === 'secondary');
      }
      if (url.startsWith('https://github.com/modelcontextprotocol/typescript-sdk')) {
        return sources.find((source) => source.id === 'github-sdk');
      }
      return undefined;
    },
    findForQuery: (query) =>
      sources
        .filter((source) =>
          source.keywords.some((keyword) => query.toLowerCase().includes(keyword)),
        )
        .sort((left, right) => right.priority - left.priority),
    list: () => sources,
    version: () => 'strict-discovery-v2',
  };
}

function result(url: string, overrides: Partial<ProviderSearchResult> = {}): ProviderSearchResult {
  return {
    title: url,
    url,
    snippet: 'x',
    engines: ['test'],
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function createUseCase(
  handler: (request: SearchProviderRequest) => Promise<{
    results: readonly ProviderSearchResult[];
    total?: number;
    unresponsiveEngines: readonly string[];
  }>,
  officialSourceRegistry: OfficialSourceRegistry = registry(),
): { useCase: SearchWeb; requests: SearchProviderRequest[] } {
  const requests: SearchProviderRequest[] = [];
  const useCase = new SearchWeb(
    {
      search: async (request) => {
        requests.push(request);
        return handler(request);
      },
    },
    new DisabledCacheRepository(),
    officialSourceRegistry,
    { cacheTtlMs: 1_000, providerOversampling: 3, maxSnippetChars: 500 },
  );
  return { useCase, requests };
}

const baseRequest: SearchRequest = {
  query: 'mcp sdk',
  language: 'en',
  maxResults: 5,
  sourcePolicy: 'strict',
};

describe('SearchWeb strict discovery', () => {
  it('prioritizes keyword-matched official sources in a single targeted pass', async () => {
    const { useCase, requests } = createUseCase(async () => ({
      results: [result('https://github.com/modelcontextprotocol/typescript-sdk/readme')],
      total: 1,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, query: 'typescript sdk' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.domainConstraints).toEqual([
      { domain: 'github.com', pathPrefix: '/modelcontextprotocol/typescript-sdk' },
    ]);
    expect(response.data.results.map((r) => r.sourceStatus)).toEqual(['VERIFIED_OFFICIAL']);
  });

  it('still discovers the official org/path repository among crowded non-official github.com results', async () => {
    const { useCase, requests } = createUseCase(async () => ({
      results: [
        result('https://github.com/someone-else/unrelated-repo-1'),
        result('https://github.com/someone-else/unrelated-repo-2'),
        result('https://github.com/someone-else/unrelated-repo-3'),
        result('https://github.com/modelcontextprotocol/typescript-sdk'),
      ],
      total: 4,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, query: 'typescript sdk' });

    expect(requests).toHaveLength(1);
    expect(response.data.results.map((r) => r.url)).toEqual([
      'https://github.com/modelcontextprotocol/typescript-sdk',
    ]);
    expect(response.data.results.map((r) => r.sourceStatus)).toEqual(['VERIFIED_OFFICIAL']);
  });

  it('falls back to the rest of the official registry when the targeted pass is insufficient', async () => {
    const { useCase, requests } = createUseCase(async (request) => {
      const domains = request.domainConstraints?.map((c) => c.domain) ?? [];
      if (domains.includes('docs.primary.test')) {
        return { results: [], total: 0, unresponsiveEngines: [] };
      }
      return {
        results: [result('https://docs.secondary.test/answer')],
        total: 1,
        unresponsiveEngines: [],
      };
    });

    const response = await useCase.execute({ ...baseRequest, query: 'mcp' });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.domainConstraints).toEqual([{ domain: 'docs.primary.test' }]);
    expect(requests[1]?.domainConstraints).toEqual([
      { domain: 'docs.secondary.test' },
      { domain: 'github.com', pathPrefix: '/modelcontextprotocol/typescript-sdk' },
    ]);
    expect(response.data.results.map((r) => r.url)).toEqual(['https://docs.secondary.test/answer']);
  });

  it('does not issue a fallback pass once the targeted pass already yields a verified official result', async () => {
    const { requests, useCase } = createUseCase(async () => ({
      results: [result('https://docs.primary.test/mcp')],
      total: 1,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, query: 'mcp' });

    expect(requests).toHaveLength(1);
    expect(response.data.results.map((r) => r.sourceStatus)).toEqual(['VERIFIED_OFFICIAL']);
  });

  it('always respects allowedDomains across both the targeted and fallback tiers', async () => {
    const { requests, useCase } = createUseCase(async () => ({
      results: [],
      total: 0,
      unresponsiveEngines: [],
    }));

    await useCase.execute({
      ...baseRequest,
      query: 'mcp',
      allowedDomains: ['docs.primary.test'],
    });

    for (const request of requests) {
      for (const constraint of request.domainConstraints ?? []) {
        expect(constraint.domain).toBe('docs.primary.test');
      }
    }
  });

  it('always respects excludedDomains across both the targeted and fallback tiers', async () => {
    const { requests, useCase } = createUseCase(async () => ({
      results: [],
      total: 0,
      unresponsiveEngines: [],
    }));

    await useCase.execute({
      ...baseRequest,
      query: 'mcp',
      excludedDomains: ['secondary.test'],
    });

    for (const request of requests) {
      expect(request.domainConstraints?.some((c) => c.domain === 'docs.secondary.test')).toBe(
        false,
      );
    }
  });

  it('rejects non-official results even when the provider returns them', async () => {
    const { useCase } = createUseCase(async () => ({
      results: [result('https://unofficial-mirror.test/mcp')],
      total: 1,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({ ...baseRequest, query: 'mcp' });

    expect(response.data.results).toEqual([]);
    expect(response.warnings.map((w) => w.code)).toContain('NO_VERIFIED_OFFICIAL_SOURCE');
  });

  it('deduplicates a result returned by both the targeted and fallback passes', async () => {
    const { useCase, requests } = createUseCase(async (request) => {
      const domains = request.domainConstraints?.map((c) => c.domain) ?? [];
      if (domains.includes('docs.primary.test')) {
        return { results: [], total: 0, unresponsiveEngines: [] };
      }
      return {
        results: [
          result('https://docs.secondary.test/answer'),
          result('https://docs.secondary.test/answer'),
        ],
        total: 2,
        unresponsiveEngines: [],
      };
    });

    const response = await useCase.execute({ ...baseRequest, query: 'mcp' });

    expect(requests).toHaveLength(2);
    expect(response.data.results.map((r) => r.url)).toEqual(['https://docs.secondary.test/answer']);
  });

  it('shares a single deadline budget across every pass it issues', async () => {
    const { useCase, requests } = createUseCase(async (request) => {
      const domains = request.domainConstraints?.map((c) => c.domain) ?? [];
      if (domains.includes('docs.primary.test')) {
        return { results: [], total: 0, unresponsiveEngines: [] };
      }
      return { results: [], total: 0, unresponsiveEngines: [] };
    });

    await useCase.execute({ ...baseRequest, query: 'mcp' });

    expect(requests.length).toBeGreaterThanOrEqual(2);
    const deadlines = new Set(requests.map((r) => r.deadlineMs));
    expect(deadlines.size).toBe(1);
  });

  it('never issues more than three provider calls (targeted, fallback, language fallback)', async () => {
    const { useCase, requests } = createUseCase(async () => ({
      results: [],
      total: 0,
      unresponsiveEngines: [],
    }));

    await useCase.execute({ ...baseRequest, query: 'mcp', language: 'fr-FR' });

    expect(requests.length).toBeLessThanOrEqual(3);
  });

  it('removes excluded official domains from query-time constraints and warns when nothing verified matches', async () => {
    const { requests, useCase } = createUseCase(async () => ({
      results: [],
      total: 0,
      unresponsiveEngines: [],
    }));

    const response = await useCase.execute({
      ...baseRequest,
      query: 'mcp',
      excludedDomains: ['primary.test'],
    });

    expect(requests[0]?.domainConstraints).not.toContainEqual({ domain: 'docs.primary.test' });
    expect(response.warnings.map((warning) => warning.code)).toContain(
      'NO_VERIFIED_OFFICIAL_SOURCE',
    );
  });
});
