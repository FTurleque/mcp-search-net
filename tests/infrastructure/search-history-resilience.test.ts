import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../src/application/ports/logger.js';
import type {
  SearchHistoryRepository,
  SearchHistoryRecordInput,
} from '../../src/application/ports/search-history-repository.js';
import { assertDistinctDatabasePaths } from '../../src/infrastructure/config/load-configuration.js';
import { SafeSearchHistoryRepository } from '../../src/infrastructure/history/safe-search-history-repository.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('search history resilience', () => {
  it('never propagates an append failure into the primary search path', async () => {
    const logger = createLogger();
    const inner: SearchHistoryRepository = {
      enabled: true,
      append: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      list: vi.fn(),
      close: vi.fn(),
    };
    const repository = new SafeSearchHistoryRepository(inner, logger);

    await expect(repository.append(record())).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'history_unavailable',
      expect.objectContaining({ operation: 'append' }),
    );
  });

  it('reports list failures as unavailable instead of fabricating history entries', async () => {
    const logger = createLogger();
    const inner: SearchHistoryRepository = {
      enabled: true,
      append: vi.fn(),
      list: vi.fn().mockRejectedValue(new Error('database locked')),
      close: vi.fn(),
    };
    const repository = new SafeSearchHistoryRepository(inner, logger);

    const page = await repository.list({ limit: 20 });

    expect(page).toEqual({
      enabled: true,
      available: false,
      items: [],
      total: 0,
    });
  });

  it('rejects cache/history collisions through aliased parent directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-history-alias-'));
    roots.push(root);
    const realDirectory = join(root, 'real');
    const aliasDirectory = join(root, 'alias');
    mkdirSync(realDirectory);
    symlinkSync(
      realDirectory,
      aliasDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(() =>
      assertDistinctDatabasePaths(
        join(aliasDirectory, 'shared.db'),
        join(root, 'catalog.db'),
        join(realDirectory, 'shared.db'),
      ),
    ).toThrow('Cache and history paths must be different');
  });

  it('rejects catalog/history collisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-history-collision-'));
    roots.push(root);
    const shared = join(root, 'shared.db');

    expect(() => assertDistinctDatabasePaths(join(root, 'cache.db'), shared, shared)).toThrow(
      'Catalog and history paths must be different',
    );
  });
});

function record(): SearchHistoryRecordInput {
  return {
    requestId: 'd94e59e5-1b91-40f2-9175-2c985723fd45',
    tool: 'search_web',
    query: 'history test',
    request: { language: 'fr-FR' },
    durationMs: 1,
    status: 'success',
    cacheStatus: 'MISS',
    provider: 'searxng',
    resultCount: 1,
    warningCodes: [],
  };
}

function createLogger(): Logger {
  return {
    record: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}
