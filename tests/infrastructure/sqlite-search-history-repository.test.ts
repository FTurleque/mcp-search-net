import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import type { SearchHistoryRecordInput } from '../../src/application/ports/search-history-repository.js';
import { SqliteSearchHistoryRepository } from '../../src/infrastructure/history/sqlite-search-history-repository.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteSearchHistoryRepository', () => {
  it('persists every invocation, including repeated identical queries, across reopen', async () => {
    const { path, clock } = createDatabase();
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);
    const first = searchRecord('same query', 'MISS');
    const second = searchRecord('same query', 'HIT');

    await repository.append(first);
    clock.advance(1_000);
    await repository.append(second);
    repository.close();

    const reopened = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);
    const page = await reopened.list({ limit: 20 });
    reopened.close();

    expect(page.available).toBe(true);
    expect(page.total).toBe(2);
    expect(page.items.map((entry) => entry.query)).toEqual(['same query', 'same query']);
    expect(page.items.map((entry) => entry.requestId)).toEqual([
      second.requestId,
      first.requestId,
    ]);
    expect(page.items.map((entry) => entry.cacheStatus)).toEqual(['HIT', 'MISS']);
  });

  it('uses stable keyset pagination without duplicates', async () => {
    const { path, clock } = createDatabase();
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);
    for (const query of ['one', 'two', 'three']) {
      await repository.append(searchRecord(query, 'MISS'));
      clock.advance(1_000);
    }

    const firstPage = await repository.list({ limit: 2 });
    expect(firstPage.items.map((entry) => entry.query)).toEqual(['three', 'two']);
    const beforeId = firstPage.nextBeforeId;
    expect(beforeId).toBeDefined();
    if (beforeId === undefined) throw new Error('Expected a next page cursor');

    const secondPage = await repository.list({
      limit: 2,
      beforeId,
    });
    repository.close();

    expect(secondPage.items.map((entry) => entry.query)).toEqual(['one']);
    expect(secondPage.nextBeforeId).toBeUndefined();
    expect(new Set([...firstPage.items, ...secondPage.items].map((entry) => entry.id)).size).toBe(
      3,
    );
  });

  it('filters by tool, cache status, date and query text', async () => {
    const { path, clock } = createDatabase();
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);
    const start = clock.now();
    await repository.append(searchRecord('SonarCloud GitHub Actions', 'MISS'));
    clock.advance(2_000);
    await repository.append({
      ...searchRecord('catalog architecture', 'DISABLED'),
      tool: 'search_docs',
      provider: 'catalog',
    });

    const page = await repository.list({
      tool: 'search_web',
      cacheStatus: 'MISS',
      from: new Date(start.getTime() - 1),
      to: new Date(start.getTime() + 1_000),
      queryContains: 'sonarcloud',
      limit: 20,
    });
    repository.close();

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.query).toBe('SonarCloud GitHub Actions');
  });

  it('purges entries older than the configured retention window on append', async () => {
    const { path, clock } = createDatabase();
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);
    await repository.append(searchRecord('old query', 'MISS'));
    clock.advance(91 * 86_400_000);
    await repository.append(searchRecord('new query', 'MISS'));

    const page = await repository.list({ limit: 20 });
    repository.close();

    expect(page.total).toBe(1);
    expect(page.items[0]?.query).toBe('new query');
  });

  it('keeps only the configured maximum number of newest entries', async () => {
    const { path, clock } = createDatabase();
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 100);
    for (let index = 0; index < 101; index += 1) {
      await repository.append(searchRecord(`query-${index}`, 'MISS'));
      clock.advance(1);
    }

    const page = await repository.list({ limit: 50 });
    repository.close();

    expect(page.total).toBe(100);
    expect(page.items[0]?.query).toBe('query-100');
    expect(page.items.some((entry) => entry.query === 'query-0')).toBe(false);
  });
});

function createDatabase(): { path: string; clock: MutableClock } {
  const root = mkdtempSync(join(tmpdir(), 'mcp-history-'));
  roots.push(root);
  return {
    path: join(root, 'history.sqlite'),
    clock: new MutableClock(new Date('2026-08-14T12:00:00.000Z')),
  };
}

function searchRecord(
  query: string,
  cacheStatus: 'HIT' | 'MISS' | 'DISABLED',
): SearchHistoryRecordInput {
  return {
    requestId: randomUUID(),
    tool: 'search_web',
    query,
    request: {
      language: 'fr-FR',
      maxResults: 5,
      sourcePolicy: 'prefer',
      allowedDomains: [],
      excludedDomains: [],
    },
    durationMs: 12.5,
    status: 'success',
    cacheStatus,
    provider: cacheStatus === 'DISABLED' ? 'catalog' : 'searxng',
    resultCount: 3,
    warningCodes: [],
  };
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
