import { describe, expect, it } from 'vitest';

import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import { FetchUrl } from '../../src/application/use-cases/fetch-url.js';
import type { FetchedContent } from '../../src/domain/models/content.js';

const officialSources = {
  findByUrl: () => undefined,
  findForQuery: () => [],
  list: () => [],
  version: () => 'audit',
} as const;

const options = {
  documentationTtlMs: 1_000,
  readmeTtlMs: 1_000,
  sitemapTtlMs: 1_000,
  maxLinks: 2,
  timeoutMs: 1_000,
  maxResponseBytes: 1_000_000,
  maxRedirects: 5,
} as const;

describe('audit fetch_url remediation', () => {
  it('preserves transport query parameters and ordering', async () => {
    let transportedUrl = '';
    const useCase = new FetchUrl(
      {
        async fetch({ url }) {
          transportedUrl = url.value;
          return content(url.value, []);
        },
      },
      new DisabledCacheRepository(),
      {
        async assertAllowed(url) {
          return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
        },
      },
      officialSources,
      options,
    );

    await useCase.execute({
      url: 'https://example.com/download?utm_source=required&b=2&a=1',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });

    expect(transportedUrl).toBe('https://example.com/download?utm_source=required&b=2&a=1');
  });

  it('bounds rejected link inspections independently from accepted links', async () => {
    let blockedInspections = 0;
    const links = Array.from({ length: 200 }, (_, index) => `https://blocked-${index}.example.test/`);
    const useCase = new FetchUrl(
      {
        async fetch({ url }) {
          return content(url.value, links);
        },
      },
      new DisabledCacheRepository(),
      {
        async assertAllowed(url) {
          if (url.includes('blocked-')) {
            blockedInspections += 1;
            throw new Error('blocked');
          }
          return { value: url, hostname: 'example.com', addresses: ['93.184.216.34'] };
        },
      },
      officialSources,
      options,
    );

    const result = await useCase.execute({
      url: 'https://example.com/docs',
      maxCharacters: 2_000,
      maxSections: 5,
      renderMode: 'static',
    });

    expect(result.data.links).toEqual([]);
    expect(blockedInspections).toBe(32);
  });
});

function content(url: string, links: readonly string[]): FetchedContent {
  return {
    requestedUrl: url,
    finalUrl: url,
    canonicalUrl: url,
    title: 'Audit docs',
    markdown: '# Audit\n\nPublic documentation content.',
    documentSections: [{ heading: 'Audit', markdown: '# Audit\n\nPublic documentation content.' }],
    contentType: 'text/html',
    fetchedAt: '2026-08-07T00:00:00.000Z',
    extractionMode: 'static',
    statusCode: 200,
    contentHash: 'audit-hash',
    redirectChain: [],
    metadata: {},
    links,
  };
}
