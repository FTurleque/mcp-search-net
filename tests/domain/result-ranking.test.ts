import { describe, expect, it } from 'vitest';

import { rankAndDeduplicate, toSearchResult } from '../../src/domain/services/result-ranking.js';

describe('result ranking', () => {
  it('boosts official sources and deduplicates canonical URLs', () => {
    const community = toSearchResult(
      {
        title: 'Community',
        url: 'https://example.net/docs/',
        snippet: '',
        score: 100,
        engines: [],
      },
      undefined,
    );
    const official = toSearchResult(
      {
        title: 'Official',
        url: 'https://docs.example.com/guide',
        snippet: '',
        score: 1,
        engines: [],
      },
      {
        id: 'example',
        name: 'Example',
        domain: 'docs.example.com',
        baseUrl: 'https://docs.example.com/',
        includeSubdomains: true,
        keywords: [],
        priority: 50,
        enabled: true,
      },
    );

    const ranked = rankAndDeduplicate(
      [community!, official!, { ...official!, title: 'Duplicate' }],
      10,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.title).toBe('Official');
    expect(ranked[0]?.official).toBe(true);
  });
});
