import { describe, expect, it } from 'vitest';

import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';

describe('audit content remediation', () => {
  it('ignores a malformed anchor target without failing the whole HTML extraction', async () => {
    const gateway = {
      async download() {
        return {
          requestedUrl: 'https://example.com/docs',
          finalUrl: 'https://example.com/docs',
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: new TextEncoder().encode(
            '<html><body><h1>Guide</h1><p>Useful public documentation content with enough words for extraction.</p><a href="http://[">Broken link</a></body></html>',
          ),
          redirectChain: [],
        };
      },
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);

    const result = await fetcher.fetch({
      url: WebUrl.createTransport('https://example.com/docs'),
      renderMode: 'static',
      timeoutMs: 1_000,
      maxResponseBytes: 1_000_000,
      maxRedirects: 5,
    });

    if ('notModified' in result) throw new Error('Expected fetched content');
    expect(result.markdown).toContain('Broken link');
    expect(result.links).toEqual([]);
  });
});
