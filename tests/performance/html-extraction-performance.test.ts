import { describe, expect, it } from 'vitest';

import { extractHtmlDocument } from '../../src/infrastructure/fetch/html-document-extractor.js';

const MAX_EXPECTED_MS = 5_000;

describe('HTML extraction adversarial performance', () => {
  it(
    'handles a large sequence of unclosed noisy containers without quadratic rescanning',
    () => {
      const html = '<div class="cookie-banner">x'.repeat(50_000);
      const startedAt = performance.now();
      const result = extractHtmlDocument(html, 'https://example.com/docs');
      const elapsedMs = performance.now() - startedAt;

      expect(result.markdown).toBe('');
      expect(result.safeHtml).toBe('');
      expect(elapsedMs).toBeLessThan(MAX_EXPECTED_MS);
    },
    10_000,
  );

  it(
    'handles a large sequence of unclosed headings without lazy whole-document regex backtracking',
    () => {
      const html = '<h1>heading'.repeat(80_000);
      const startedAt = performance.now();
      const result = extractHtmlDocument(html, 'https://example.com/docs');
      const elapsedMs = performance.now() - startedAt;

      expect(result.markdown).toContain('# heading');
      expect(elapsedMs).toBeLessThan(MAX_EXPECTED_MS);
    },
    10_000,
  );
});
