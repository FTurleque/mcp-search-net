import { describe, expect, it } from 'vitest';

import { extractHtmlDocument } from '../../src/infrastructure/fetch/html-document-extractor.js';

describe('linear HTML document extractor', () => {
  it('extracts metadata and Markdown while removing noisy blocks and active content', () => {
    const result = extractHtmlDocument(
      '<html><head><title>Docs &amp; API</title><script><link rel="canonical" href="https://evil.invalid/"></script><link rel="canonical" href="/canonical"></head><body><div class="cookie-banner"><p>tracking consent text</p></div><h1>Guide</h1><p>Useful public documentation content with enough words for extraction.</p><a href="/next?utm_source=x">Next</a></body></html>',
      'https://example.com/docs',
    );

    expect(result.title).toBe('Docs & API');
    expect(result.canonicalUrl).toBe('https://example.com/canonical');
    expect(result.markdown).toContain('# Guide');
    expect(result.markdown).toContain('Useful public documentation');
    expect(result.markdown).not.toContain('tracking consent text');
    expect(result.links).toEqual(['https://example.com/next']);
    expect(result.safeHtml).not.toContain('<script');
    expect(result.safeHtml).not.toContain('cookie-banner');
  });

  it('discards the remainder conservatively when a noisy container is never closed', () => {
    const result = extractHtmlDocument(
      '<main><h1>Visible</h1><p>Useful text before noise.</p><div class="cookie-banner"><p>noise<h1>Hidden</h1>',
      'https://example.com/docs',
    );

    expect(result.markdown).toContain('# Visible');
    expect(result.markdown).not.toContain('Hidden');
    expect(result.safeHtml).not.toContain('cookie-banner');
    expect(result.safeHtml).not.toContain('Hidden');
  });

  it('keeps malformed-link text while excluding the invalid target', () => {
    const result = extractHtmlDocument(
      '<p>Useful documentation content before <a href="http://[">Broken link</a> and after.</p>',
      'https://example.com/docs',
    );

    expect(result.markdown).toContain('Broken link');
    expect(result.links).toEqual([]);
  });
});
