import { describe, expect, it } from 'vitest';

import {
  createSearchCacheKey,
  normalizeSearchRequest,
} from '../../src/application/services/search-request.js';
import type { SearchRequest } from '../../src/domain/models/search.js';

const base: SearchRequest = {
  query: '  Model   Context Protocol  ',
  maxResults: 5,
};

describe('search request normalization', () => {
  const behavior = { providerOversampling: 3, maxSnippetChars: 500 } as const;
  it('applies safe defaults and canonicalizes language, query and domains', () => {
    expect(
      normalizeSearchRequest({
        ...base,
        language: 'fr-fr',
        allowedDomains: ['Docs.Example.COM.', 'docs.example.com'],
        excludedDomains: ['BLOG.EXAMPLE.COM'],
      }),
    ).toEqual({
      query: 'Model Context Protocol',
      language: 'fr-FR',
      maxResults: 5,
      sourcePolicy: 'prefer',
      allowedDomains: ['docs.example.com'],
      excludedDomains: ['blog.example.com'],
    });
  });

  it('rejects control characters and more than twenty domains', () => {
    expect(() => normalizeSearchRequest({ ...base, query: 'mcp\nsearch' })).toThrow(
      /control characters/u,
    );
    expect(() =>
      normalizeSearchRequest({
        ...base,
        allowedDomains: Array.from({ length: 21 }, (_, index) => `d${index}.example.com`),
      }),
    ).toThrow(/20 domains/u);
  });

  it('includes every influential field in the cache key and ignores domain ordering', () => {
    const normalized = normalizeSearchRequest(base);
    const key = createSearchCacheKey(normalized, 'registry-a', behavior);
    const variants = [
      { ...normalized, query: 'Other query' },
      { ...normalized, language: 'en' },
      { ...normalized, timeRange: 'week' as const },
      { ...normalized, maxResults: 4 },
      { ...normalized, sourcePolicy: 'strict' as const },
      { ...normalized, allowedDomains: ['example.com'] },
      { ...normalized, excludedDomains: ['example.com'] },
    ];
    expect(
      variants.every((variant) => createSearchCacheKey(variant, 'registry-a', behavior) !== key),
    ).toBe(true);
    expect(createSearchCacheKey(normalized, 'registry-b', behavior)).not.toBe(key);
    expect(
      createSearchCacheKey(normalized, 'registry-a', {
        ...behavior,
        providerOversampling: 2,
      }),
    ).not.toBe(key);
    expect(
      createSearchCacheKey(normalized, 'registry-a', { ...behavior, maxSnippetChars: 200 }),
    ).not.toBe(key);

    const ordered = normalizeSearchRequest({
      ...base,
      allowedDomains: ['b.example.com', 'a.example.com'],
    });
    const reversed = normalizeSearchRequest({
      ...base,
      allowedDomains: ['a.example.com', 'b.example.com'],
    });
    expect(createSearchCacheKey(ordered, 'registry-a', behavior)).toBe(
      createSearchCacheKey(reversed, 'registry-a', behavior),
    );
  });
});
