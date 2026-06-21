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
            resolvedUrl: url,
            title: 'Documentation',
            markdown: '# Intro\n\nOther.\n\n## Cache\n\nSQLite cache transactions.',
            contentType: 'text/html',
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
      { now: () => new Date('2026-06-21T00:00:00.000Z') },
      { cacheTtlMs: 1_000, maxLinks: 10 },
    );

    const response = await useCase.execute({
      url: 'https://example.com/docs',
      query: 'SQLite cache',
      maxChars: 2_000,
    });

    expect(response.markdown).toContain('## Cache');
    expect(response.markdown).not.toContain('# Intro');
    expect(response.metadata.source).toEqual({ language: 'en' });
  });
});
