import { describe, expect, it, vi } from 'vitest';

import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import {
  ExtractionError,
  OcrRequiredNotSupportedError,
  RequestTimeoutError,
  UnsupportedContentTypeError,
} from '../../src/domain/errors/domain-errors.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';

describe('Crawl4aiContentFetcher', () => {
  it('extracts downloaded HTML without giving Crawl4AI the public URL', async () => {
    const gateway = {
      download: vi.fn(async () => ({
        requestedUrl: 'https://example.com/docs',
        finalUrl: 'https://example.com/docs',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode(
          '<html><head><title>Docs</title><link rel="canonical" href="/canonical"></head><body><nav>Menu</nav><h1>Guide</h1><p>Useful documentation content with enough text to extract safely.</p><script>steal()</script><a href="/next?utm_source=x">Next</a></body></html>',
        ),
        redirectChain: [],
      })),
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn() as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher('http://127.0.0.1:11235', undefined, gateway, crawl);
    const result = await fetcher.fetch(fetchRequest('https://example.com/docs', 'static'));
    if ('notModified' in result) throw new Error('Expected fetched content');
    expect(result).toMatchObject({
      title: 'Docs',
      finalUrl: 'https://example.com/docs',
      canonicalUrl: 'https://example.com/canonical',
      contentType: 'text/html',
      extractionMode: 'static',
    });
    expect(result.markdown).toContain('# Guide');
    expect(result.markdown).not.toContain('steal');
    expect(result.links).toEqual(['https://example.com/next']);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.documentSections.map((section) => section.heading)).toContain('Guide');
    expect(crawl).not.toHaveBeenCalled();
  });

  it('propagates permanent redirect metadata from the gateway', async () => {
    const redirectChain = [
      {
        fromUrl: 'https://example.com/docs',
        toUrl: 'https://www.example.com/docs',
        status: 301,
        permanent: true,
      },
    ];
    const gateway = {
      download: vi.fn(async () => ({
        requestedUrl: 'https://example.com/docs',
        finalUrl: 'https://www.example.com/docs',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode(
          '<html><head><title>Moved Docs</title></head><body><h1>Moved</h1><p>Useful documentation content after a permanent redirect.</p></body></html>',
        ),
        redirectChain,
      })),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);

    const result = await fetcher.fetch(fetchRequest('https://example.com/docs', 'static'));

    if ('notModified' in result) throw new Error('Expected fetched content');
    expect(result).toMatchObject({
      finalUrl: 'https://www.example.com/docs',
      canonicalUrl: 'https://www.example.com/docs',
      metadata: { redirectChain, redirectedPermanently: true },
    });
  });

  it('keeps a temporary final hop out of canonical identity after a permanent redirect', async () => {
    const redirectChain = [
      {
        fromUrl: 'https://example.com/docs',
        toUrl: 'https://example.com/stable-docs',
        status: 301,
        permanent: true,
      },
      {
        fromUrl: 'https://example.com/stable-docs',
        toUrl: 'https://example.com/preview-docs',
        status: 302,
        permanent: false,
      },
    ];
    const gateway = {
      download: vi.fn(async () => ({
        requestedUrl: 'https://example.com/docs',
        finalUrl: 'https://example.com/preview-docs',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode(
          '<html><head><title>Preview Docs</title></head><body><h1>Preview</h1><p>Useful documentation content served through a temporary final redirect.</p></body></html>',
        ),
        redirectChain,
      })),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);

    const result = await fetcher.fetch(fetchRequest('https://example.com/docs', 'static'));

    if ('notModified' in result) throw new Error('Expected fetched content');
    expect(result).toMatchObject({
      finalUrl: 'https://example.com/preview-docs',
      canonicalUrl: 'https://example.com/stable-docs',
      metadata: { redirectChain, redirectedPermanently: true },
    });
  });

  it.each([
    ['application/json', '{"ok":true}', '```json'],
    ['application/xml', '<root>value</root>', '```xml'],
    ['application/yaml', 'name: value', '```yaml'],
    ['text/markdown', '# README\n\nDocumentation content.', '# README'],
    ['text/plain', 'robots and llms textual documentation content', 'robots'],
  ])('supports %s', async (contentType, body, expected) => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/file',
        finalUrl: 'https://example.com/file',
        status: 200,
        headers: { 'content-type': contentType },
        body: new TextEncoder().encode(body),
      }),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);
    await expect(
      fetcher.fetch(fetchRequest('https://example.com/file', 'static')),
    ).resolves.toMatchObject({
      markdown: expect.stringContaining(expected),
    });
  });

  it('uses only sanitized prepared raw HTML for the auto native-render fallback', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/app',
        finalUrl: 'https://example.com/app',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode(
          '<html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1"><link rel="stylesheet" href="http://127.0.0.1/a.css"></head><body><img src="http://127.0.0.1/x"><div style="background:url(http://127.0.0.1/y)"></div><div data-marker="srcdoc-neutralized" srcdoc="&lt;img src=&#39;http://127.0.0.1/srcdoc&#39;&gt;">neutralized</div><svg><image href="http://127.0.0.1/svg.png" xlink:href="http://127.0.0.1/legacy.svg"></image></svg><a href="/safe" ping="http://127.0.0.1/ping">safe link</a></body></html>',
        ),
      }),
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { urls: string[] };
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-test-token-123');
      expect(payload.urls[0]).toMatch(/^raw:\/\/<html/u);
      expect(payload.urls[0]).not.toContain('example.com');
      expect(payload.urls[0]).not.toContain('<link');
      expect(payload.urls[0]).not.toContain('<meta');
      expect(payload.urls[0]).not.toContain('<svg');
      expect(payload.urls[0]).not.toContain('xlink:href');
      expect(payload.urls[0]).not.toContain(' srcdoc=');
      expect(payload.urls[0]).not.toContain(' ping=');
      expect(payload.urls[0]).not.toContain('127.0.0.1');
      return new Response(
        JSON.stringify({
          results: [
            {
              success: true,
              markdown:
                '# Rendered\n\nUseful native rendered documentation content with enough reliable fallback words.',
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher(
      'http://crawl4ai',
      'local-test-token-123',
      gateway,
      crawl,
    );
    await expect(
      fetcher.fetch(fetchRequest('https://example.com/app', 'auto')),
    ).resolves.toMatchObject({
      extractionMode: 'native-render',
      markdown: expect.stringContaining('Rendered'),
    });
  });

  it('maps an unavailable Crawl4AI renderer to the content provider error', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/app',
        finalUrl: 'https://example.com/app',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode('<html><body>tiny</body></html>'),
      }),
    } as unknown as SecureHttpGateway;
    const unavailable = vi.fn(async () => {
      throw new TypeError('connection refused');
    }) as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway, unavailable);
    await expect(
      fetcher.fetch(fetchRequest('https://example.com/app', 'auto')),
    ).rejects.toMatchObject({
      code: 'CONTENT_PROVIDER_UNAVAILABLE',
    });
  });

  it('does not renew the download budget before native rendering', async () => {
    const download = vi.fn(async () => ({
      requestedUrl: 'https://example.com/app',
      finalUrl: 'https://example.com/app',
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<html><body>tiny</body></html>'),
    }));
    const gateway = {
      download,
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn() as unknown as typeof fetch;
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(900).mockReturnValueOnce(1_001);
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway, crawl);
    try {
      await expect(
        fetcher.fetch({ ...fetchRequest('https://example.com/app', 'auto'), deadline: 1_000 }),
      ).rejects.toBeInstanceOf(RequestTimeoutError);
      expect(crawl).not.toHaveBeenCalled();
      expect(download).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeoutMs: 100 }),
      );
    } finally {
      now.mockRestore();
    }
  });

  it('succeeds when download and native rendering both fit the shared deadline', async () => {
    const gateway = {
      download: vi.fn(async () => ({
        requestedUrl: 'https://example.com/app',
        finalUrl: 'https://example.com/app',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode('<html><body>tiny</body></html>'),
      })),
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                success: true,
                markdown: '# Rendered\n\nUseful rendered content with enough words for success.',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(900).mockReturnValueOnce(950);
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway, crawl);
    try {
      await expect(
        fetcher.fetch({ ...fetchRequest('https://example.com/app', 'auto'), deadline: 1_000 }),
      ).resolves.toMatchObject({ extractionMode: 'native-render' });
      const requestBody = vi.mocked(crawl).mock.calls[0]?.[1]?.body;
      expect(requestBody).toBeTypeOf('string');
      if (typeof requestBody !== 'string') throw new Error('Expected string request body');
      const body = JSON.parse(requestBody) as {
        crawler_config: { page_timeout: number };
      };
      expect(body.crawler_config.page_timeout).toBe(50);
    } finally {
      now.mockRestore();
    }
  });

  it('never invokes native rendering after the download phase times out', async () => {
    const gateway = {
      download: vi.fn(async () => Promise.reject(new RequestTimeoutError())),
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn() as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway, crawl);

    await expect(
      fetcher.fetch(fetchRequest('https://example.com/app', 'auto')),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(crawl).not.toHaveBeenCalled();
  });

  it('sends validators only to their exact URI and maps refreshed 304 headers', async () => {
    const download = vi.fn(async () => ({
      requestedUrl: 'https://example.com/docs',
      finalUrl: 'https://example.com/docs',
      status: 304,
      headers: {
        etag: '"v2"',
        'last-modified': 'Wed, 12 Aug 2026 08:00:00 GMT',
      },
      body: new Uint8Array(),
      redirectChain: [],
    }));
    const gateway = { download } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);
    await expect(
      fetcher.fetch(fetchRequest('https://example.com/docs', 'static'), {
        cacheValidators: {
          etag: '"v1"',
          lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
          contentHash: 'abc',
          validatorUrl: 'https://example.com/docs',
        },
      }),
    ).resolves.toEqual({
      notModified: true,
      requestedUrl: 'https://example.com/docs',
      finalUrl: 'https://example.com/docs',
      redirectChain: [],
      etag: '"v2"',
      lastModified: 'Wed, 12 Aug 2026 08:00:00 GMT',
    });
    expect(download).toHaveBeenCalledWith(
      'https://example.com/docs',
      { 'if-none-match': '"v1"', 'if-modified-since': 'Sun, 21 Jun 2026 00:00:00 GMT' },
      { tool: 'fetch_url' },
      { timeoutMs: 1_000, maxBytes: 1_000_000, maxRedirects: 5 },
    );
  });

  it('does not send validators when they belong to a different URI', async () => {
    const download = vi.fn(async () => ({
      requestedUrl: 'https://example.com/old-docs',
      finalUrl: 'https://example.com/new-docs',
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('Useful documentation content returned after redirect change.'),
      redirectChain: [
        {
          fromUrl: 'https://example.com/old-docs',
          toUrl: 'https://example.com/new-docs',
          status: 302,
          permanent: false,
        },
      ],
    }));
    const gateway = { download } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);

    await fetcher.fetch(fetchRequest('https://example.com/old-docs', 'static'), {
      cacheValidators: {
        etag: '"v1"',
        validatorUrl: 'https://example.com/new-docs',
      },
    });

    expect(download).toHaveBeenCalledWith(
      'https://example.com/old-docs',
      {},
      { tool: 'fetch_url' },
      { timeoutMs: 1_000, maxBytes: 1_000_000, maxRedirects: 5 },
    );
  });

  it('returns explicit errors for binary and invalid PDF content', async () => {
    const make = (contentType: string, body: string) =>
      new Crawl4aiContentFetcher('http://crawl4ai', undefined, {
        download: async () => ({
          requestedUrl: 'https://example.com/file',
          finalUrl: 'https://example.com/file',
          status: 200,
          headers: { 'content-type': contentType },
          body: new TextEncoder().encode(body),
        }),
      } as unknown as SecureHttpGateway);
    await expect(
      make('application/zip', 'binary archive').fetch(
        fetchRequest('https://example.com/file', 'static'),
      ),
    ).rejects.toBeInstanceOf(UnsupportedContentTypeError);
    await expect(
      make('application/pdf', '%PDF image only').fetch(
        fetchRequest('https://example.com/file.pdf', 'static'),
      ),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('converts HTML pre, code and list elements to markdown', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/ref',
        finalUrl: 'https://example.com/ref',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode(
          '<html><body>' +
            '<h2>Reference</h2>' +
            '<ul><li>Item one</li><li>Item two</li></ul>' +
            '<pre><code>npm install mcp-search-net</code></pre>' +
            '<code>inline snippet</code>' +
            '<p>Additional documentation paragraph with sufficient words.</p>' +
            '</body></html>',
        ),
      }),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);
    const result = await fetcher.fetch(fetchRequest('https://example.com/ref', 'static'));
    if ('notModified' in result) throw new Error('Expected fetched content');
    expect(result.markdown).toContain('## Reference');
    expect(result.markdown).toContain('- Item one');
    expect(result.markdown).toContain('`inline snippet`');
    expect(result.markdown).toContain('npm install');
  });

  it('rejects image content with OcrRequiredNotSupportedError', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/diagram.png',
        finalUrl: 'https://example.com/diagram.png',
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([137, 80, 78, 71]),
      }),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);
    await expect(
      fetcher.fetch(fetchRequest('https://example.com/diagram.png', 'static')),
    ).rejects.toBeInstanceOf(OcrRequiredNotSupportedError);
  });

  it('extracts text from a standard textual PDF', async () => {
    const pdf = makeTextPdf('Public documentation from a textual PDF file');
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/guide.pdf',
        finalUrl: 'https://example.com/guide.pdf',
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: pdf,
      }),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway);
    await expect(
      fetcher.fetch(fetchRequest('https://example.com/guide.pdf', 'static')),
    ).resolves.toMatchObject({
      markdown: expect.stringContaining('Public documentation'),
    });
  });
});

function fetchRequest(url: string, renderMode: 'static' | 'auto') {
  return {
    url: WebUrl.create(url),
    renderMode,
    timeoutMs: 1_000,
    maxResponseBytes: 1_000_000,
    maxRedirects: 5,
  } as const;
}

function makeTextPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source, 'latin1');
}
