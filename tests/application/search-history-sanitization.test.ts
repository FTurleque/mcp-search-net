import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../src/application/ports/logger.js';
import type {
  SearchHistoryRepository,
  SearchHistoryRecordInput,
} from '../../src/application/ports/search-history-repository.js';
import {
  redactSensitiveSearchText,
  sanitizeSearchHistoryRecord,
} from '../../src/application/services/search-history-sanitization.js';
import { SafeSearchHistoryRepository } from '../../src/infrastructure/history/safe-search-history-repository.js';

describe('search history sanitization', () => {
  it('redacts common credential forms while preserving the useful query text', () => {
    const query =
      'debug authorization=Bearer abcdefghijklmnop api_key=super-secret ghp_abcdefghijklmnopqrstuvwxyz012345';

    const sanitized = redactSensitiveSearchText(query);

    expect(sanitized).toContain('debug');
    expect(sanitized).toContain('authorization=[REDACTED]');
    expect(sanitized).toContain('api_key=[REDACTED]');
    expect(sanitized).not.toContain('abcdefghijklmnop');
    expect(sanitized).not.toContain('super-secret');
    expect(sanitized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz012345');
  });

  it('redacts sensitive request keys and token-shaped string values', () => {
    const record = sanitizeSearchHistoryRecord(
      historyRecord({
        query: 'find docs password=hunter2',
        request: {
          language: 'fr-FR',
          apiToken: 'should-never-be-persisted',
          filters: ['public', 'Bearer abcdefghijklmnop'],
        },
      }),
    );

    expect(record.query).toBe('find docs password=[REDACTED]');
    expect(record.request).toEqual({
      language: 'fr-FR',
      apiToken: '[REDACTED]',
      filters: ['public', 'Bearer [REDACTED]'],
    });
  });

  it('sanitizes before delegating to persistent history storage', async () => {
    const append = vi.fn().mockResolvedValue(true);
    const inner: SearchHistoryRepository = {
      enabled: true,
      append,
      list: vi.fn(),
      close: vi.fn(),
    };
    const repository = new SafeSearchHistoryRepository(inner, logger());

    await repository.append(historyRecord({ query: 'search token=top-secret' }));

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'search token=[REDACTED]' }),
    );
  });
});

function historyRecord(
  overrides: Partial<SearchHistoryRecordInput> = {},
): SearchHistoryRecordInput {
  return {
    requestId: '67f62725-063f-4c68-82e2-92cbabbdc43b',
    tool: 'search_web',
    query: 'history query',
    request: { language: 'fr-FR' },
    durationMs: 12,
    status: 'success',
    cacheStatus: 'MISS',
    provider: 'searxng',
    resultCount: 1,
    warningCodes: [],
    ...overrides,
  };
}

function logger(): Logger {
  return {
    record: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}
