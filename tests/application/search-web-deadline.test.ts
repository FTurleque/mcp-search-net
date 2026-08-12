import { describe, expect, it } from 'vitest';

import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import type {
  SearchProvider,
  SearchProviderRequest,
} from '../../src/application/ports/search-provider.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';

describe('SearchWeb provider deadline', () => {
  it('shares one absolute deadline across the primary and fallback searches', async () => {
    const requests: SearchProviderRequest[] = [];
    const provider: SearchProvider = {
      async search(request) {
        requests.push(request);
        return { results: [], total: 0, unresponsiveEngines: [] };
      },
    };
    const registry = {
      findByUrl: () => undefined,
      findForQuery: () => [],
      list: () => [],
      version: () => '1',
    };
    const timeoutMs = 1_000;
    const useCase = new SearchWeb(provider, new DisabledCacheRepository(), registry, {
      cacheTtlMs: 1_000,
      providerOversampling: 3,
      maxSnippetChars: 500,
      providerTimeoutMs: timeoutMs,
    });
    const startedAt = Date.now();

    await useCase.execute({
      query: 'mcp',
      language: 'fr-FR',
      maxResults: 5,
      sourcePolicy: 'any',
      allowedDomains: [],
      excludedDomains: [],
    });

    expect(requests.map((request) => request.language)).toEqual(['fr-FR', 'en']);
    expect(requests[0]?.deadlineMs).toBeDefined();
    expect(requests[1]?.deadlineMs).toBe(requests[0]?.deadlineMs);
    expect(requests[0]?.deadlineMs).toBeGreaterThanOrEqual(startedAt);
    expect(requests[0]?.deadlineMs).toBeLessThanOrEqual(startedAt + timeoutMs);
  });
});
