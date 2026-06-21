import { describe, expect, it } from 'vitest';

import { FetchUrl } from '../../src/application/use-cases/fetch-url.js';
import type { CacheRecord, CacheRepository } from '../../src/application/ports/cache-repository.js';

class NoCache implements CacheRepository {
  public async get<T>(): Promise<CacheRecord<T> | undefined> {
    return undefined;
  }
  public async set(): Promise<void> {}
  public async delete(): Promise<void> {}
  public async prune(): Promise<number> {
    return 0;
  }
  public close(): void {}
}

describe('FetchUrl', () => {
  it('selects content and preserves metadata', async () => {
    const useCase = new FetchUrl(
      {
        async fetch(url) {
          return {
            requestedUrl: url,
            finalUrl: url,
            canonicalUrl: url,
            title: 'Documentation',
            markdown: '# Intro\n\nOther.\n\n## Cache\n\nSQLite cache transactions.',
            contentType: 'text/html',
            fetchedAt: '2026-06-20T00:00:00.000Z',
            extractionMode: 'static' as const,
            metadata: { language: 'en' },
            links: ['https://example.com/next'],
          };
        },
      },
      new NoCache(),
      {
        async assertAllowed(url) {
          return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
        },
      },
      { findByUrl: () => undefined, findForQuery: () => [], list: () => [], version: () => '1' },
      { cacheTtlMs: 1_000, maxLinks: 10 },
    );

    const response = await useCase.execute({
      url: 'https://example.com/docs',
      query: 'SQLite cache',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });

    expect(response.data.markdown).toContain('## Cache');
    expect(response.data.markdown).not.toContain('# Intro');
    expect(response.data.fetchedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(response.data.sectionCount).toBe(1);
    expect(response.cacheStatus).toBe('MISS');
  });

  it('filters blocked links and never exposes provider metadata', async () => {
    const useCase = new FetchUrl(
      {
        async fetch(url) {
          return {
            requestedUrl: url,
            finalUrl: url,
            canonicalUrl: url,
            markdown: '# Safe\n\nPublic documentation content.',
            contentType: 'text/html',
            fetchedAt: '2026-06-21T00:00:00.000Z',
            extractionMode: 'static',
            metadata: { secret: 'must-not-leak' },
            links: ['https://example.com/ok', 'http://127.0.0.1/private'],
          };
        },
      },
      new NoCache(),
      {
        async assertAllowed(url) {
          if (url.includes('127.0.0.1')) throw new Error('blocked');
          return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
        },
      },
      { findByUrl: () => undefined, findForQuery: () => [], list: () => [], version: () => '1' },
      { cacheTtlMs: 1_000, maxLinks: 10 },
    );
    const response = await useCase.execute({
      url: 'https://example.com',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });
    expect(response.data.links).toEqual(['https://example.com/ok']);
    expect(JSON.stringify(response.data)).not.toContain('must-not-leak');
  });
});
