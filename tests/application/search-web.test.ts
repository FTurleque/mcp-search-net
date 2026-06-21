import { describe, expect, it } from 'vitest';

import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import type { CacheRecord, CacheRepository } from '../../src/application/ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type { SearchProvider } from '../../src/application/ports/search-provider.js';

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

describe('SearchWeb', () => {
  it('returns official results first and caches them', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      async search() {
        calls += 1;
        return {
          results: [
            {
              title: 'Community',
              url: 'https://blog.example.net/mcp',
              snippet: 'x',
              score: 10,
              engines: ['a'],
            },
            {
              title: 'Official',
              url: 'https://docs.example.com/mcp',
              snippet: 'y',
              score: 1,
              engines: ['b'],
            },
          ],
          total: 2,
          unresponsiveEngines: [],
        };
      },
    };
    const registry: OfficialSourceRegistry = {
      findByUrl: (url) =>
        url.includes('docs.example.com')
          ? {
              id: 'docs',
              name: 'Docs',
              domain: 'docs.example.com',
              baseUrl: 'https://docs.example.com/',
              includeSubdomains: true,
              keywords: ['mcp'],
              priority: 100,
              enabled: true,
            }
          : undefined,
      findForQuery: () => [],
      list: () => [],
      version: () => '1',
    };
    const useCase = new SearchWeb(provider, new MemoryCache(), registry, {
      cacheTtlMs: 1_000,
      providerOversampling: 2,
      maxSnippetChars: 500,
    });
    const request = { query: 'mcp', maxResults: 5, officialOnly: false } as const;

    const first = await useCase.execute(request);
    const second = await useCase.execute(request);

    expect(first.results[0]?.official).toBe(true);
    expect(first.metadata.cached).toBe(false);
    expect(second.metadata.cached).toBe(true);
    expect(calls).toBe(1);
  });
});
