import { describe, expect, it } from 'vitest';

import { DomainName } from '../../src/domain/value-objects/domain-name.js';
import { RelevanceScore } from '../../src/domain/value-objects/relevance-score.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';

describe('V1 value objects', () => {
  it('normalizes Web URLs and removes fragments and tracking parameters', () => {
    expect(
      WebUrl.create('HTTPS://Example.COM:443/docs/?utm_source=test&b=2&a=1#section').value,
    ).toBe('https://example.com/docs?a=1&b=2');
    expect(() => WebUrl.create('file:///etc/passwd')).toThrow(/HTTP and HTTPS/u);
    expect(() => WebUrl.create(`https://example.com/${'a'.repeat(4_096)}`)).toThrow(/4096/u);
  });

  it('matches domains only on DNS label boundaries', () => {
    const domain = DomainName.create('JetBrains.COM.');
    expect(domain.value).toBe('jetbrains.com');
    expect(domain.matches('www.jetbrains.com')).toBe(true);
    expect(domain.matches('jetbrains.com.example.org')).toBe(false);
  });

  it('normalizes search queries and rejects control characters', () => {
    expect(SearchQuery.create('  Model   Context Protocol ').value).toBe('Model Context Protocol');
    expect(() => SearchQuery.create('mcp\nsearch')).toThrow(/control characters/u);
  });

  it('keeps relevance scores finite and bounded', () => {
    expect(RelevanceScore.create(0.5).compare(RelevanceScore.create(0.25))).toBeGreaterThan(0);
    expect(RelevanceScore.clamp(2).value).toBe(1);
    expect(() => RelevanceScore.create(Number.NaN)).toThrow(/finite/u);
  });
});
