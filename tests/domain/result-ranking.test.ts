import { describe, expect, it } from 'vitest';

import type { OfficialSource } from '../../src/domain/models/official-source.js';
import {
  matchesDomain,
  normalizeResultUrl,
  rankAndDeduplicate,
  toSearchResult,
} from '../../src/domain/services/result-ranking.js';

const officialSource: OfficialSource = {
  id: 'example',
  name: 'Example',
  domain: 'docs.example.com',
  baseUrl: 'https://docs.example.com/',
  includeSubdomains: true,
  githubOrganizations: [],
  keywords: [],
  priority: 100,
  enabled: true,
};

describe('result ranking', () => {
  it('ranks verified sources first with scores bounded between zero and one', () => {
    const community = toSearchResult(
      {
        title: 'Community article',
        url: 'https://medium.com/mcp?utm_source=test',
        snippet: '',
        score: 100,
        engines: [],
      },
      { query: 'mcp sdk' },
    );
    const official = toSearchResult(
      {
        title: 'MCP SDK documentation',
        url: 'https://docs.example.com/guide',
        snippet: '',
        score: 1,
        engines: [],
      },
      { query: 'mcp sdk', officialSource },
    );

    const ranked = rankAndDeduplicate([community!, official!]);
    expect(ranked[0]?.sourceStatus).toBe('VERIFIED_OFFICIAL');
    expect(ranked.every((result) => result.score >= 0 && result.score <= 1)).toBe(true);
  });

  it('normalizes tracking parameters and deduplicates canonically equivalent URLs', () => {
    const first = toSearchResult(
      {
        title: 'B title',
        url: 'https://EXAMPLE.com:443/docs/?utm_source=x&b=2&a=1#part',
        snippet: '',
        score: 1,
        engines: ['b'],
      },
      { query: 'docs' },
    );
    const second = toSearchResult(
      {
        title: 'A title',
        url: 'https://example.com/docs?a=1&b=2',
        snippet: '',
        score: 1,
        engines: ['a'],
      },
      { query: 'docs' },
    );

    const ranked = rankAndDeduplicate([first!, second!]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.url).toBe('https://example.com/docs?a=1&b=2');
    expect(ranked[0]?.title).toBe('A title');
  });

  it('classifies only registry entries as verified official', () => {
    const create = (url: string) =>
      toSearchResult({ title: 'Result', url, snippet: '', engines: [] }, { query: 'result' })
        ?.sourceStatus;

    expect(create('https://sub.example.com/page')).toBe('UNKNOWN');
    expect(create('https://developer.vendor.test/reference')).toBe('LIKELY_OFFICIAL');
    expect(create('https://stackoverflow.com/questions/1')).toBe('THIRD_PARTY');
    expect(create('https://example.net/page')).toBe('UNKNOWN');
  });

  it('uses a stable title and URL order when scores are equal', () => {
    const context = { query: 'unrelated' } as const;
    const beta = toSearchResult(
      { title: 'Beta', url: 'https://example.net/b', snippet: '', engines: [] },
      context,
    );
    const alphaZ = toSearchResult(
      { title: 'Alpha', url: 'https://example.net/z', snippet: '', engines: [] },
      context,
    );
    const alphaA = toSearchResult(
      { title: 'Alpha', url: 'https://example.net/a', snippet: '', engines: [] },
      context,
    );

    expect(rankAndDeduplicate([beta!, alphaZ!, alphaA!]).map((result) => result.url)).toEqual([
      'https://example.net/a',
      'https://example.net/z',
      'https://example.net/b',
    ]);
  });

  it('matches domains only on DNS label boundaries', () => {
    expect(matchesDomain('docs.example.com', ['example.com'])).toBe(true);
    expect(matchesDomain('example.com.attacker.test', ['example.com'])).toBe(false);
    expect(normalizeResultUrl('file:///etc/passwd')).toBeUndefined();
  });
});
