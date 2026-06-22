import { describe, expect, it, vi } from 'vitest';

import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import {
  ExtractionError,
  UnsupportedContentTypeError,
} from '../../src/domain/errors/domain-errors.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

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
      })),
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn() as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher(
      'http://127.0.0.1:11235',
      1_000,
      undefined,
      gateway,
      crawl,
    );
    const result = await fetcher.fetch('https://example.com/docs', 'static');
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
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', 1_000, undefined, gateway);
    await expect(fetcher.fetch('https://example.com/file', 'static')).resolves.toMatchObject({
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
          '<html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1"><link rel="stylesheet" href="http://127.0.0.1/a.css"></head><body><img src="http://127.0.0.1/x"><div style="background:url(http://127.0.0.1/y)">tiny</div></body></html>',
        ),
      }),
    } as unknown as SecureHttpGateway;
    const crawl = vi.fn(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { urls: string[] };
      expect(payload.urls[0]).toMatch(/^raw:\/\/<html/u);
      expect(payload.urls[0]).not.toContain('example.com');
      expect(payload.urls[0]).not.toContain('<link');
      expect(payload.urls[0]).not.toContain('<meta');
      expect(payload.urls[0]).not.toContain('127.0.0.1');
      return new Response(
        JSON.stringify({
          results: [
            {
              success: true,
              markdown: '# Rendered\n\nUseful native rendered documentation content.',
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', 1_000, undefined, gateway, crawl);
    await expect(fetcher.fetch('https://example.com/app', 'auto')).resolves.toMatchObject({
      extractionMode: 'native-render',
      markdown: expect.stringContaining('Rendered'),
    });
  });

  it('sends safe HTTP validators and maps 304 without re-extracting content', async () => {
    const download = vi.fn(async () => ({
      requestedUrl: 'https://example.com/docs',
      finalUrl: 'https://example.com/docs',
      status: 304,
      headers: {},
      body: new Uint8Array(),
    }));
    const gateway = { download } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', 1_000, undefined, gateway);
    await expect(
      fetcher.fetch('https://example.com/docs', 'static', {
        etag: '"v1"',
        lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
        contentHash: 'abc',
      }),
    ).resolves.toEqual({ notModified: true });
    expect(download).toHaveBeenCalledWith(
      'https://example.com/docs',
      { 'if-none-match': '"v1"', 'if-modified-since': 'Sun, 21 Jun 2026 00:00:00 GMT' },
      { tool: 'fetch_url' },
    );
  });

  it('returns explicit errors for binary and invalid PDF content', async () => {
    const make = (contentType: string, body: string) =>
      new Crawl4aiContentFetcher('http://crawl4ai', 1_000, undefined, {
        download: async () => ({
          requestedUrl: 'https://example.com/file',
          finalUrl: 'https://example.com/file',
          status: 200,
          headers: { 'content-type': contentType },
          body: new TextEncoder().encode(body),
        }),
      } as unknown as SecureHttpGateway);
    await expect(
      make('application/zip', 'binary archive').fetch('https://example.com/file', 'static'),
    ).rejects.toBeInstanceOf(UnsupportedContentTypeError);
    await expect(
      make('application/pdf', '%PDF image only').fetch('https://example.com/file.pdf', 'static'),
    ).rejects.toBeInstanceOf(ExtractionError);
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
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', 1_000, undefined, gateway);
    await expect(fetcher.fetch('https://example.com/guide.pdf', 'static')).resolves.toMatchObject({
      markdown: expect.stringContaining('Public documentation'),
    });
  });
});

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
