import { describe, expect, it } from 'vitest';

import type { SearchHistoryRepository } from '../../src/application/ports/search-history-repository.js';
import { ListSearchHistory } from '../../src/application/use-cases/list-search-history.js';

const entry = {
  id: 42,
  requestId: '0cc64e61-297b-4761-b936-0bfa1f513bc3',
  tool: 'search_web' as const,
  query: 'SonarCloud GitHub Actions',
  request: { language: 'fr-FR', maxResults: 5 },
  executedAt: new Date('2026-08-14T18:00:00.000Z'),
  durationMs: 42.5,
  status: 'success' as const,
  cacheStatus: 'MISS' as const,
  provider: 'searxng',
  resultCount: 5,
  warningCodes: [] as const,
};

describe('ListSearchHistory', () => {
  it('maps repository dates and optional values to the public data contract', async () => {
    const repository: SearchHistoryRepository = {
      enabled: true,
      append: async () => true,
      list: async () => ({
        enabled: true,
        available: true,
        items: [entry],
        total: 1,
      }),
      close() {},
    };
    const useCase = new ListSearchHistory(repository);

    const output = await useCase.execute({ limit: 20 });

    expect(output).toEqual({
      enabled: true,
      available: true,
      count: 1,
      total: 1,
      nextBeforeId: null,
      searches: [
        {
          ...entry,
          executedAt: '2026-08-14T18:00:00.000Z',
          cacheStatus: 'MISS',
          resultCount: 5,
          errorCode: null,
        },
      ],
    });
  });

  it('rejects an inverted date range before reading the repository', async () => {
    let called = false;
    const repository: SearchHistoryRepository = {
      enabled: true,
      append: async () => true,
      list: async () => {
        called = true;
        return { enabled: true, available: true, items: [], total: 0 };
      },
      close() {},
    };
    const useCase = new ListSearchHistory(repository);

    await expect(
      useCase.execute({
        from: new Date('2026-08-15T00:00:00.000Z'),
        to: new Date('2026-08-14T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(called).toBe(false);
  });
});
