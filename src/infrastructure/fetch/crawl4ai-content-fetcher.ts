import { createHash } from 'node:crypto';

import { z } from 'zod/v4';

import type { ContentFetcher } from '../../application/ports/content-fetcher.js';
import type { ContentFetchResult, FetchedContent } from '../../domain/models/content.js';
import type {
  ContentFetchContext,
  ContentFetchRequest,
} from '../../application/ports/content-fetcher.js';
import {
  ContentProviderUnavailableError,
  ExtractionError,
  OcrRequiredNotSupportedError,
  RequestTimeoutError,
  UnsupportedContentTypeError,
} from '../../domain/errors/domain-errors.js';
import { normalizeResultUrl } from '../../domain/services/result-ranking.js';
import { extractDocumentSections } from '../../domain/services/content-selection.js';
import { fetchJson } from '../http/http-utils.js';
import { extractPdfText } from './pdf-text-extractor.js';
import { sanitizePreparedHtml } from './prepared-html-sanitizer.js';
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
    private readonly apiToken: string | undefined,
    private readonly gateway: SecureHttpGateway,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async fetch(
    request: ContentFetchRequest,
    context: ContentFetchContext = {},
  ): Promise<ContentFetchResult> {
    const deadline = request.deadline ?? performance.now() + request.timeoutMs;
    const resource = await this.gateway.download(
      request.url.value,
      createConditionalHeaders(context.cacheValidators),
      {
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
        tool: 'fetch_url',
      },
      {
        timeoutMs: remainingTimeoutMs(deadline),
        maxBytes: request.maxResponseBytes,
        maxRedirects: request.maxRedirects,
      },
    );
    if (resource.status === 304) {
      return {
        notModified: true,
        requestedUrl: resource.requestedUrl,
        finalUrl: resource.finalUrl,
        redirectChain: resource.redirectChain ?? [],
      };
    }
    const contentType = detectContentType(resource);
    const decoded = await decodeResource(resource, contentType);
    let markdown = decoded.markdown;
    let extractionMode: FetchedContent['extractionMode'] = 'static';

    if (request.renderMode === 'auto' && isHtml(contentType) && !isUseful(markdown)) {
      const rendered = await this.renderPreparedHtml(
        decoded.safeHtml ?? '',
        remainingTimeoutMs(deadline),
      );
      if (isUseful(rendered)) markdown = rendered;
      extractionMode = 'native-render';
    }
    if (markdown.trim() === '')
      throw new ExtractionError('No usable textual content was extracted');

    const redirectChain = resource.redirectChain ?? [];
    const redirectedPermanently = redirectChain.some((redirect) => redirect.permanent);

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
      redirectChain,
      metadata: {
        status: resource.status,
        bytes: resource.body.byteLength,
        ...(resource.headers['etag'] === undefined ? {} : { etag: resource.headers['etag'] }),
        ...(resource.headers['last-modified'] === undefined
          ? {}
          : { lastModified: resource.headers['last-modified'] }),
        ...(redirectChain.length === 0 ? {} : { redirectChain }),
        ...(redirectedPermanently ? { redirectedPermanently: true } : {}),
      },
      links: decoded.links,
    };
  }

  private async renderPreparedHtml(html: string, timeoutMs: number): Promise<string> {
    const endpoint = new URL('/crawl', ensureTrailingSlash(this.baseUrl));
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.apiToken !== undefined) headers['authorization'] = `Bearer ${this.apiToken}`;
    // Crawl4AI's raw:// transport renders caller-provided HTML without issuing a
    // public target request. The renderer receives only resource-neutralized HTML.
    const rawUrl = `raw://${html}`;
    const json = await fetchJson(
      'crawl4ai',
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          urls: [rawUrl],
          browser_config: { text_mode: true, light_mode: true },
          crawler_config: { check_robots_txt: false, page_timeout: timeoutMs },
        }),
      },
      timeoutMs,
      this.fetchImplementation,
    );
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success)
      throw new ContentProviderUnavailableError('crawl4ai returned an invalid rendering response');
    const result = envelope.data.results?.[0] ?? envelope.data.result;
    if (!result?.success) throw new ExtractionError('crawl4ai native rendering failed');
    if (typeof result.markdown === 'string') return result.markdown;
    return result.markdown?.fit_markdown ?? result.markdown?.raw_markdown ?? '';
  }
}

function remainingTimeoutMs(deadline: number): number {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw new RequestTimeoutError('fetch_url operation deadline exceeded');
  return remaining;
}

function createConditionalHeaders(
  context: ContentFetchContext['cacheValidators'],
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (isSafeHeaderValue(context?.etag)) headers['if-none-match'] = context.etag;
  if (isSafeHeaderValue(context?.lastModified)) headers['if-modified-since'] = context.lastModified;
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
    throw new OcrRequiredNotSupportedError();
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
  const safeHtml = sanitizePreparedHtml(removeNoisyBlocks(html));
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
      (_all, href: string, body: string) => formatMarkdownLink(href, body, baseUrl),
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
  const noisyAttribute = '(?:class|id|aria-label|role|data-testid|data-test|data-component)';
  const noisyPattern =
    String.raw`<([a-z][\w:-]*)\b[^>]*${noisyAttribute}\s*=\s*["'][^"']*(?:` +
    String.raw`cookie|consent|banner|modal|dialog|sidebar|breadcrumb|pagination|advert|promo|tracking|analytics|footer|header|nav|menu|share|social|newsletter|subscribe|search)[^"']*["'][^>]*>[\s\S]*?<\/\1>`;
  for (let index = 0; index < 3; index += 1) {
    cleaned = cleaned.replace(new RegExp(noisyPattern, 'giu'), ' ');
  }
  return cleaned;
}

function collectPlainLinks(text: string, baseUrl: string): readonly string[] {
  const urls = [...text.matchAll(/https?:\/\/[^\s)>'"]+/giu)].flatMap((match) =>
    normalizeLink(match[0], baseUrl),
  );
  return [...new Set(urls)];
}

function normalizeLink(value: string, baseUrl: string): readonly string[] {
  try {
    const normalized = normalizeResultUrl(new URL(value, baseUrl).toString());
    return normalized === undefined ? [] : [normalized];
  } catch {
    return [];
  }
}

function formatMarkdownLink(href: string, body: string, baseUrl: string): string {
  const text = stripTags(body);
  try {
    return `[${text}](${new URL(href, baseUrl).toString()})`;
  } catch {
    return text;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ');
}

function detectContentType(resource: DownloadedResource): string {
  return (
    (resource.headers['content-type'] ?? 'text/plain').split(';')[0]?.trim().toLowerCase() ??
    'text/plain'
  );
}

function isHtml(contentType: string): boolean {
  return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}

function isUseful(markdown: string): boolean {
  return markdown.trim().split(/\s+/u).filter(Boolean).length >= 8;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

async function decodePdf(body: Uint8Array): Promise<DecodedContent> {
  const decoded = await extractPdfText(body);
  return { markdown: decoded, links: collectPlainLinks(decoded, 'https://example.invalid/') };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
