import { describe, expect, it } from 'vitest';

import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type { SearchProviderRequest } from '../../src/application/ports/search-provider.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import type { OfficialSource } from '../../src/domain/models/official-source.js';

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

function registry(): OfficialSourceRegistry {
  return {
    findByUrl: (url) =>
      url.includes(primary.domain)
        ? primary
        : url.includes(secondary.domain)
          ? secondary
          : undefined,
    findForQuery: (query) => (query.includes('mcp') ? [primary] : []),
    list: () => [secondary, primary],
    version: () => 'strict-discovery-v1',
  };
}

describe('SearchWeb strict discovery', () => {
  it('constrains provider discovery to verified registry domains before filtering results', async () => {
    const requests: SearchProviderRequest[] = [];
    const useCase = new SearchWeb(
      {
        search: async (request) => {
          requests.push(request);
          return {
            results: [
              {
                title: 'Primary MCP docs',
                url: 'https://docs.primary.test/mcp',
                snippet: 'official',
                engines: ['test'],
                updatedAt: '2026-08-22T00:00:00.000Z',
              },
            ],
            total: 1,
            unresponsiveEngines: [],
          };
        },
      },
      new DisabledCacheRepository(),
      registry(),
      { cacheTtlMs: 1_000, providerOversampling: 3, maxSnippetChars: 500 },
    );

    const response = await useCase.execute({
      query: 'mcp sdk',
      language: 'en',
      maxResults: 5,
      sourcePolicy: 'strict',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.domainConstraints).toEqual([
      'docs.primary.test',
      'docs.secondary.test',
    ]);
    expect(response.data.results.map((result) => result.sourceStatus)).toEqual([
      'VERIFIED_OFFICIAL',
    ]);
  });

  it('removes excluded official domains from query-time constraints', async () => {
    const requests: SearchProviderRequest[] = [];
    const useCase = new SearchWeb(
      {
        search: async (request) => {
          requests.push(request);
          return { results: [], total: 0, unresponsiveEngines: [] };
        },
      },
      new DisabledCacheRepository(),
      registry(),
      { cacheTtlMs: 1_000, providerOversampling: 3, maxSnippetChars: 500 },
    );

    const response = await useCase.execute({
      query: 'mcp sdk',
      language: 'en',
      maxResults: 5,
      sourcePolicy: 'strict',
      excludedDomains: ['primary.test'],
    });

    expect(requests[0]?.domainConstraints).toEqual(['docs.secondary.test']);
    expect(response.warnings.map((warning) => warning.code)).toContain(
      'NO_VERIFIED_OFFICIAL_SOURCE',
    );
  });
});
