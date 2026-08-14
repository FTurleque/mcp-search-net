import { describe, expect, it } from 'vitest';

import type {
  CacheRecord,
  CacheRepository,
} from '../../src/application/ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../../src/application/ports/official-source-registry.js';
import type {
  SearchHistoryListQuery,
  SearchHistoryPage,
  SearchHistoryRecordInput,
  SearchHistoryRepository,
} from '../../src/application/ports/search-history-repository.js';
import type { SearchProvider } from '../../src/application/ports/search-provider.js';
import { TrackedSearchWeb } from '../../src/application/use-cases/tracked-search-web.js';
import type { SearchRequest } from '../../src/domain/models/search.js';

class MemoryCache implements CacheRepository {
  private readonly values = new Map<string, unknown>();

  public getSearch<T>(key: string): Promise<CacheRecord<T> | undefined> {
    const value = this.values.get(key) as T | undefined;
    return Promise.resolve(
      value === undefined
        ? undefined
        : {
            value,
            createdAt: new Date(0),
            expiresAt: new Date(4_102_444_800_000),
            stale: false,
          },
    );
  }

  public setSearch<T>(key: string, value: T): Promise<boolean> {
    this.values.set(key, value);
    return Promise.resolve(true);
  }

  public getContent<T>(): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }

  public setContent(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }

  public close(): void {
    // In-memory test cache has no external resource.
  }
}

class RecordingHistory implements SearchHistoryRepository {
  public readonly enabled = true;
  public readonly records: SearchHistoryRecordInput[] = [];

  public append(record: SearchHistoryRecordInput): Promise<boolean> {
    this.records.push(record);
    return Promise.resolve(true);
  }

  public list(_query: SearchHistoryListQuery): Promise<SearchHistoryPage> {
    return Promise.resolve({ enabled: true, available: true, items: [], total: 0 });
  }

  public close(): void {
    // In-memory test history has no external resource.
  }
}

const registry: OfficialSourceRegistry = {
  findByUrl: () => undefined,
  findForQuery: () => [],
  list: () => [],
  version: () => '1',
};

const request: SearchRequest = {
  query: 'tracked web history',
  language: 'fr-FR',
  maxResults: 5,
  sourcePolicy: 'any',
  allowedDomains: [],
  excludedDomains: [],
};

describe('TrackedSearchWeb', () => {
  it('records a MISS and then a HIT as two separate invocations with their request ids', async () => {
    let providerCalls = 0;
    const provider: SearchProvider = {
      search: async () => {
        providerCalls += 1;
        return {
          results: [
            {
              title: 'Tracked result',
              url: 'https://example.com/docs',
              snippet: 'Tracked snippet',
              score: 1,
              engines: ['test'],
              updatedAt: '2026-08-14T00:00:00.000Z',
            },
          ],
          total: 1,
          unresponsiveEngines: [],
        };
      },
    };
    const history = new RecordingHistory();
    const useCase = createUseCase(provider, history);

    const first = await useCase.execute(request, {
      requestId: '8f23e6f1-1b5a-4df7-afae-4014407a8485',
    });
    const second = await useCase.execute(request, {
      requestId: '4717bb46-3ce7-4775-87fe-c71f1486465f',
    });

    expect(first.cacheStatus).toBe('MISS');
    expect(second.cacheStatus).toBe('HIT');
    expect(providerCalls).toBe(1);
    expect(history.records).toHaveLength(2);
    expect(history.records).toEqual([
      expect.objectContaining({
        requestId: '8f23e6f1-1b5a-4df7-afae-4014407a8485',
        tool: 'search_web',
        query: 'tracked web history',
        status: 'success',
        cacheStatus: 'MISS',
        provider: 'searxng',
        resultCount: 1,
      }),
      expect.objectContaining({
        requestId: '4717bb46-3ce7-4775-87fe-c71f1486465f',
        tool: 'search_web',
        query: 'tracked web history',
        status: 'success',
        cacheStatus: 'HIT',
        provider: 'searxng',
        resultCount: 1,
      }),
    ]);
  });

  it('records a validated provider failure and preserves the original failure', async () => {
    const providerError = new Error('provider exploded');
    const provider: SearchProvider = {
      search: async () => {
        throw providerError;
      },
    };
    const history = new RecordingHistory();
    const useCase = createUseCase(provider, history);

    await expect(
      useCase.execute(request, {
        requestId: '458812f6-e161-43ba-94c7-ff85bec831ce',
      }),
    ).rejects.toBe(providerError);

    expect(history.records).toEqual([
      expect.objectContaining({
        requestId: '458812f6-e161-43ba-94c7-ff85bec831ce',
        tool: 'search_web',
        query: 'tracked web history',
        status: 'failed',
        provider: 'searxng',
        errorCode: 'INTERNAL_ERROR',
      }),
    ]);
  });
});

function createUseCase(
  provider: SearchProvider,
  history: SearchHistoryRepository,
): TrackedSearchWeb {
  return new TrackedSearchWeb(
    provider,
    new MemoryCache(),
    registry,
    {
      cacheTtlMs: 60_000,
      providerOversampling: 1,
      maxSnippetChars: 500,
      providerTimeoutMs: 1_000,
    },
    undefined,
    history,
  );
}
