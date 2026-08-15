import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import { SqliteSearchHistoryRepository } from '../../src/infrastructure/history/sqlite-search-history-repository.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('search history read-only retention', () => {
  it('filters expired rows during list without deleting persistent history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-history-readonly-'));
    roots.push(root);
    const path = join(root, 'history.sqlite');
    const clock = new MutableClock(new Date('2026-01-01T00:00:00.000Z'));
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);

    await repository.append({
      requestId: '11111111-1111-4111-8111-111111111111',
      tool: 'search_web',
      query: 'expired but still durable',
      request: { language: 'fr-FR', maxResults: 5 },
      durationMs: 10,
      status: 'success',
      cacheStatus: 'MISS',
      provider: 'searxng',
      resultCount: 1,
      warningCodes: [],
    });
    clock.advance(91 * 86_400_000);

    const page = await repository.list({ limit: 20 });
    repository.close();

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
    expect(countRows(path)).toBe(1);
  });
});

function countRows(path: string): number {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare<[], { readonly count: number }>('SELECT count(*) AS count FROM search_history')
      .get();
    return row?.count ?? 0;
  } finally {
    database.close();
  }
}

class MutableClock implements Clock {
  public constructor(private value: Date) {}

  public now(): Date {
    return new Date(this.value);
  }

  public advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}
