import { describe, expect, it } from 'vitest';

import {
  decodeFetchedContent,
  decodeSearchCacheValue,
  type SearchCacheValue,
} from '../../src/application/services/cache-value-validation.js';
import type { FetchedContent } from '../../src/domain/models/content.js';
import {
  MAX_EXTERNAL_DOCUMENT_SECTIONS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../src/domain/services/bounded-text.js';

describe('cache value semantic validation', () => {
  it('accepts values that satisfy the current search cache contract', () => {
    const value = validSearchCacheValue();
    expect(decodeSearchCacheValue(value)).toEqual(value);
  });

  it('rejects search cache values that violate response semantics', () => {
    const base = validSearchCacheValue();
    const result = base.data.results[0];
    expect(result).toBeDefined();
    if (result === undefined) return;

    const invalidValues: readonly unknown[] = [
      {
        ...base,
        data: { ...base.data, results: [{ ...result, score: 1.01 }] },
      },
      {
        ...base,
        data: { ...base.data, results: [{ ...result, url: 'not-a-url' }] },
      },
      {
        ...base,
        data: { ...base.data, results: [{ ...result, publishedAt: 'yesterday' }] },
      },
      {
        ...base,
        data: { ...base.data, results: [{ ...result, engines: Array(33).fill('engine') }] },
      },
      {
        ...base,
        data: {
          ...base.data,
          results: [{ ...result, title: '😀'.repeat(MAX_EXTERNAL_TITLE_CHARACTERS + 1) }],
        },
      },
      {
        ...base,
        data: { ...base.data, metadata: { ...base.data.metadata, retrievedAt: 'invalid-date' } },
      },
      {
        ...base,
        data: { ...base.data, metadata: { ...base.data.metadata, returned: 2 } },
      },
      {
        ...base,
        warnings: [{ code: 'NO_RESULTS', message: '' }],
      },
    ];

    for (const value of invalidValues) {
      expect(decodeSearchCacheValue(value)).toBeUndefined();
    }
  });

  it('accepts values that satisfy the current fetched-content cache contract', () => {
    const value = validFetchedContent();
    expect(decodeFetchedContent(value)).toEqual(value);
  });

  it('rejects fetched-content cache values that cannot safely feed fetch_url', () => {
    const base = validFetchedContent();
    const section = base.documentSections[0];
    expect(section).toBeDefined();
    if (section === undefined) return;

    const invalidValues: readonly unknown[] = [
      { ...base, finalUrl: 'file:///etc/passwd' },
      { ...base, fetchedAt: 'not-an-iso-date' },
      { ...base, contentType: '' },
      { ...base, statusCode: 500 },
      { ...base, contentHash: 'not-a-sha256' },
      { ...base, etag: 'unsafe\r\nheader' },
      {
        ...base,
        documentSections: Array.from(
          { length: MAX_EXTERNAL_DOCUMENT_SECTIONS + 1 },
          () => section,
        ),
      },
      {
        ...base,
        redirectChain: [
          {
            fromUrl: 'https://example.test/start',
            toUrl: 'javascript:alert(1)',
            status: 302,
            permanent: false,
          },
        ],
      },
      { ...base, links: ['javascript:alert(1)'] },
    ];

    for (const value of invalidValues) {
      expect(decodeFetchedContent(value)).toBeUndefined();
    }
  });
});

function validSearchCacheValue(): SearchCacheValue {
  return {
    status: 'success',
    warnings: [],
    data: {
      query: 'node documentation',
      results: [
        {
          title: 'Node.js documentation',
          url: 'https://nodejs.org/docs/latest/api/',
          domain: 'nodejs.org',
          snippet: 'Official Node.js API documentation.',
          sourceStatus: 'VERIFIED_OFFICIAL',
          engines: ['documentation'],
          publishedAt: '2026-08-11T18:00:00.000Z',
          updatedAt: '2026-08-11T18:30:00.000Z',
          detectedLanguage: 'en-US',
          score: 0.95,
        },
      ],
      metadata: {
        total: 1,
        returned: 1,
        unresponsiveEngines: [],
        sourceProvider: 'searxng',
        retrievedAt: '2026-08-11T19:00:00.000Z',
      },
    },
  };
}

function validFetchedContent(): FetchedContent {
  return {
    requestedUrl: 'https://example.test/docs',
    finalUrl: 'https://example.test/docs',
    canonicalUrl: 'https://example.test/docs',
    title: 'Example documentation',
    markdown: '# Example\n\nSafe cached content.',
    documentSections: [{ heading: 'Example', markdown: '# Example\n\nSafe cached content.' }],
    contentType: 'text/html',
    fetchedAt: '2026-08-11T19:00:00.000Z',
    extractionMode: 'static',
    statusCode: 200,
    etag: '"example-v1"',
    lastModified: 'Tue, 11 Aug 2026 19:00:00 GMT',
    contentHash: 'a'.repeat(64),
    redirectChain: [],
    metadata: { status: 200, bytes: 42 },
    links: ['https://example.test/reference'],
  };
}
