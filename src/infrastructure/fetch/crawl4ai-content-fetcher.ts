import { createHash } from 'node:crypto';

import { z } from 'zod/v4';

import type { ContentFetcher } from '../../application/ports/content-fetcher.js';
import type {
  ContentFetchResult,
  FetchedContent,
  RenderMode,
} from '../../domain/models/content.js';
import type { ContentFetchContext } from '../../application/ports/content-fetcher.js';
import {
  ExternalServiceError,
  ExtractionError,
  OcrRequiredError,
  UnsupportedContentTypeError,
} from '../../domain/errors/domain-errors.js';
import { normalizeResultUrl } from '../../domain/services/result-ranking.js';
import { extractDocumentSections } from '../../domain/services/content-selection.js';
import { fetchJson } from '../http/http-utils.js';
import type { DownloadedResource } from './secure-http-gateway.js';
import type { SecureHttpGateway } from './secure-http-gateway.js';

const crawlResultSchema = z
  .object({
    success: z.boolean().optional().default(true),
    markdown: z
      .union([
        z.string(),
        z
          .object({
            raw_markdown: z.string().optional(),
            fit_markdown: z.string().nullable().optional(),
          })
          .loose(),
      ])
      .optional(),
    error_message: z.string().optional(),
  })
  .loose();
const envelopeSchema = z
  .object({ results: z.array(crawlResultSchema).optional(), result: crawlResultSchema.optional() })
  .loose();

export class Crawl4aiContentFetcher implements ContentFetcher {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly apiToken: string | undefined,
    private readonly gateway: SecureHttpGateway,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async fetch(
    url: string,
    renderMode: RenderMode,
    context: ContentFetchContext = {},
  ): Promise<ContentFetchResult> {
    const resource = await this.gateway.download(url, createConditionalHeaders(context), {
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      tool: 'fetch_url',
    });
    if (resource.status === 304) return { notModified: true };
    const contentType = detectContentType(resource);
    const decoded = await decodeResource(resource, contentType);
    let markdown = decoded.markdown;
    let extractionMode: FetchedContent['extractionMode'] = 'static';

    if (renderMode === 'auto' && isHtml(contentType) && !isUseful(markdown)) {
      const rendered = await this.renderPreparedHtml(decoded.safeHtml ?? '');
      if (isUseful(rendered)) markdown = rendered;
      extractionMode = 'native-render';
    }
    if (markdown.trim() === '')
      throw new ExtractionError('No usable textual content was extracted');

    return {
      requestedUrl: resource.requestedUrl,
      finalUrl: resource.finalUrl,
      canonicalUrl: decoded.canonicalUrl ?? resource.finalUrl,
      ...(decoded.title === undefined ? {} : { title: decoded.title }),
      markdown,
      documentSections: extractDocumentSections(markdown),
      contentType,
      fetchedAt: new Date().toISOString(),
      extractionMode,
      statusCode: resource.status,
      ...(resource.headers['etag'] === undefined ? {} : { etag: resource.headers['etag'] }),
      ...(resource.headers['last-modified'] === undefined
        ? {}
        : { lastModified: resource.headers['last-modified'] }),
      contentHash: createHash('sha256').update(resource.body).digest('hex'),
      metadata: {
        status: resource.status,
        bytes: resource.body.byteLength,
        ...(resource.headers['etag'] === undefined ? {} : { etag: resource.headers['etag'] }),
        ...(resource.headers['last-modified'] === undefined
          ? {}
          : { lastModified: resource.headers['last-modified'] }),
      },
      links: decoded.links,
    };
  }

  private async renderPreparedHtml(html: string): Promise<string> {
    const endpoint = new URL('/crawl', ensureTrailingSlash(this.baseUrl));
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.apiToken !== undefined) headers['authorization'] = `Bearer ${this.apiToken}`;
    const dataUrl = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
    const json = await fetchJson(
      'crawl4ai',
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          urls: [dataUrl],
          browser_config: { text_mode: true, light_mode: true },
          crawler_config: { check_robots_txt: false, page_timeout: this.timeoutMs },
        }),
      },
      this.timeoutMs,
      this.fetchImplementation,
    );
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success)
      throw new ExternalServiceError('crawl4ai returned an invalid rendering response', 'crawl4ai');
    const result = envelope.data.results?.[0] ?? envelope.data.result;
    if (!result?.success) throw new ExtractionError('crawl4ai native rendering failed');
    if (typeof result.markdown === 'string') return result.markdown;
    return result.markdown?.fit_markdown ?? result.markdown?.raw_markdown ?? '';
  }
}

function createConditionalHeaders(context: ContentFetchContext): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (isSafeHeaderValue(context.etag)) headers['if-none-match'] = context.etag;
  if (isSafeHeaderValue(context.lastModified)) headers['if-modified-since'] = context.lastModified;
  return headers;
}

function isSafeHeaderValue(value: string | undefined): value is string {
  return value !== undefined && value.length <= 1_024 && !/[\r\n]/u.test(value);
}

interface DecodedContent {
  readonly markdown: string;
  readonly title?: string;
  readonly canonicalUrl?: string;
  readonly links: readonly string[];
  readonly safeHtml?: string;
}

async function decodeResource(
  resource: DownloadedResource,
  contentType: string,
): Promise<DecodedContent> {
  if (contentType === 'application/pdf') return decodePdf(resource.body);
  if (contentType.startsWith('image/')) {
    throw new OcrRequiredError();
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(resource.body).replace(/\0/gu, '');
  if (isHtml(contentType)) return decodeHtml(text, resource.finalUrl);
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    try {
      return {
        markdown: `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``,
        links: [],
      };
    } catch (error) {
      throw new ExtractionError('The JSON document is invalid', { cause: error });
    }
  }
  if (
    contentType.includes('xml') ||
    contentType.includes('yaml') ||
    contentType === 'application/x-yaml'
  ) {
    const language = contentType.includes('xml') ? 'xml' : 'yaml';
    return {
      markdown: `\`\`\`${language}\n${text.trim()}\n\`\`\``,
      links: collectPlainLinks(text, resource.finalUrl),
    };
  }
  if (contentType.startsWith('text/') || contentType === 'application/markdown') {
    return { markdown: text.trim(), links: collectPlainLinks(text, resource.finalUrl) };
  }
  throw new UnsupportedContentTypeError(`Unsupported content type: ${contentType}`);
}

function decodeHtml(html: string, baseUrl: string): DecodedContent {
  const title =
    decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '').trim() || undefined;
  const canonical =
    /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["']/iu.exec(html)?.[1] ??
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*canonical[^"']*["']/iu.exec(html)?.[1];
  const safeHtml = removeNoisyBlocks(html)
    .replace(/<(script|style|noscript|iframe|form|nav|aside)\b[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<!--([\s\S]*?)-->/gu, ' ')
    .replace(/\s(?:src|srcset|action|poster|data|on\w+)\s*=\s*(?:["'][^"']*["']|[^\s>]+)/giu, '');
  const links = [...safeHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)].flatMap((match) =>
    normalizeLink(match[1] ?? '', baseUrl),
  );
  let markdown = safeHtml
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu,
      (_all, level: string, body: string) =>
        `\n\n${'#'.repeat(Number(level))} ${stripTags(body)}\n\n`,
    )
    .replace(
      /<pre\b[^>]*>([\s\S]*?)<\/pre>/giu,
      (_all, body: string) => `\n\n\`\`\`\n${decodeEntities(stripTags(body)).trim()}\n\`\`\`\n\n`,
    )
    .replace(
      /<code\b[^>]*>([\s\S]*?)<\/code>/giu,
      (_all, body: string) => `\`${decodeEntities(stripTags(body)).trim()}\``,
    )
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_all, body: string) => `\n- ${stripTags(body)}`)
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
      (_all, href: string, body: string) =>
        `[${stripTags(body)}](${new URL(href, baseUrl).toString()})`,
    )
    .replace(/<(br|p|div|section|article|main|header|footer|table|tr)\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
  markdown = decodeEntities(markdown)
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return {
    markdown,
    ...(title === undefined ? {} : { title }),
    ...(canonical === undefined ? {} : { canonicalUrl: normalizeLink(canonical, baseUrl)[0] }),
    links: [...new Set(links)],
    safeHtml,
  };
}

function removeNoisyBlocks(value: string): string {
  let cleaned = value;
  const noisyAttribute =
    /<(\w+)\b[^>]*(?:aria-hidden\s*=\s*["']?true|\bhidden\b|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)|(?:class|id|role)\s*=\s*["'][^"']*(?:advert|banner|cookie|menu|navigation|popup|sidebar))[^>]*>[\s\S]*?<\/\1>/giu;
  for (let pass = 0; pass < 3; pass += 1) cleaned = cleaned.replace(noisyAttribute, ' ');
  return cleaned;
}

async function decodePdf(bytes: Uint8Array): Promise<DecodedContent> {
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const document = await loadingTask.promise;
    const pages: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .flatMap((item) => ('str' in item && typeof item.str === 'string' ? [item.str] : []))
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim();
        if (text !== '') pages.push(`## Page ${pageNumber}\n\n${text}`);
      }
    } finally {
      await loadingTask.destroy();
    }
    const markdown = pages.join('\n\n');
    if (markdown.replace(/[^\p{L}\p{N}]/gu, '').length < 20) throw new OcrRequiredError();
    return { markdown, links: [] };
  } catch (error) {
    if (error instanceof OcrRequiredError) throw error;
    throw new ExtractionError('The PDF document is invalid or cannot be parsed', { cause: error });
  }
}

function detectContentType(resource: DownloadedResource): string {
  const header = resource.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (header !== undefined && header !== '' && header !== 'application/octet-stream') return header;
  const path = new URL(resource.finalUrl).pathname.toLowerCase();
  if (path.endsWith('.md') || path.endsWith('/readme') || path.endsWith('/llms.txt'))
    return 'text/markdown';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.xml') || path.endsWith('/sitemap.xml')) return 'application/xml';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'application/yaml';
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.txt') || path.endsWith('/robots.txt')) return 'text/plain';
  return 'application/octet-stream';
}

function collectPlainLinks(value: string, baseUrl: string): readonly string[] {
  return [
    ...new Set(
      [...value.matchAll(/https?:\/\/[^\s<>"')]+/giu)].flatMap((match) =>
        normalizeLink(match[0], baseUrl),
      ),
    ),
  ];
}

function normalizeLink(value: string, baseUrl: string): readonly string[] {
  try {
    const normalized = normalizeResultUrl(new URL(value, baseUrl).toString());
    return normalized === undefined ? [] : [normalized];
  } catch {
    return [];
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ');
}
function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (_all, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? '';
  });
}
function isHtml(value: string): boolean {
  return value === 'text/html' || value === 'application/xhtml+xml';
}
function isUseful(value: string): boolean {
  return value.replace(/[^\p{L}\p{N}]/gu, '').length >= 40;
}
function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
