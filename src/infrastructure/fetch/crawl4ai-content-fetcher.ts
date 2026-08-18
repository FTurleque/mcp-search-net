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
import { extractDocumentSections } from '../../domain/services/content-selection.js';
import { permanentRedirectTarget } from '../../domain/services/redirect-chain.js';
import { normalizeResultUrl } from '../../domain/services/result-ranking.js';
import { fetchJson } from '../http/http-utils.js';
import { extractHtmlDocument } from './html-document-extractor.js';
import { extractPdfText } from './pdf-text-extractor.js';
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

interface FetchSecurityContext {
  readonly requestId?: string;
  readonly tool: 'fetch_url';
}

interface ExtractedMarkdown {
  readonly markdown: string;
  readonly extractionMode: FetchedContent['extractionMode'];
}

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
    const securityContext = createSecurityContext(context);
    const resource = await this.downloadResource(request, context, securityContext, deadline);
    if (resource.status === 304) return toNotModifiedContent(resource);

    const contentType = detectContentType(resource);
    const decoded = await decodeResource(resource, contentType, deadline);
    const extracted = await this.extractMarkdown(request, decoded, contentType, deadline);
    const redirectChain = resource.redirectChain ?? [];
    const permanentTarget = permanentRedirectTarget(redirectChain);
    const canonicalUrl = await approveCanonicalUrl(
      decoded.canonicalUrl,
      permanentTarget ?? resource.finalUrl,
      this.gateway,
      securityContext,
      deadline,
    );

    return toFetchedContent(
      resource,
      decoded,
      extracted,
      contentType,
      canonicalUrl,
      permanentTarget,
    );
  }

  private downloadResource(
    request: ContentFetchRequest,
    context: ContentFetchContext,
    securityContext: FetchSecurityContext,
    deadline: number,
  ): Promise<DownloadedResource> {
    return this.gateway.download(
      request.url.value,
      validatorsApplyTo(request.url.value, context.cacheValidators)
        ? createConditionalHeaders(context.cacheValidators)
        : {},
      securityContext,
      {
        timeoutMs: remainingTimeoutMs(deadline),
        maxBytes: request.maxResponseBytes,
        maxRedirects: request.maxRedirects,
      },
    );
  }

  private async extractMarkdown(
    request: ContentFetchRequest,
    decoded: DecodedContent,
    contentType: string,
    deadline: number,
  ): Promise<ExtractedMarkdown> {
    if (request.renderMode === 'auto' && isHtml(contentType) && !isUseful(decoded.markdown)) {
      const rendered = await this.renderPreparedHtml(
        decoded.safeHtml ?? '',
        remainingTimeoutMs(deadline),
      );
      if (isUseful(rendered)) return { markdown: rendered, extractionMode: 'native-render' };
    }
    if (decoded.markdown.trim() === '') {
      throw new ExtractionError('No usable textual content was extracted');
    }
    return { markdown: decoded.markdown, extractionMode: 'static' };
  }

  private async renderPreparedHtml(html: string, timeoutMs: number): Promise<string> {
    const endpoint = new URL('/crawl', ensureTrailingSlash(this.baseUrl));
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.apiToken !== undefined) headers['authorization'] = `Bearer ${this.apiToken}`;
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

function createSecurityContext(context: ContentFetchContext): FetchSecurityContext {
  return {
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
    tool: 'fetch_url',
  };
}

function toNotModifiedContent(resource: DownloadedResource): ContentFetchResult {
  return {
    notModified: true,
    requestedUrl: resource.requestedUrl,
    finalUrl: resource.finalUrl,
    redirectChain: resource.redirectChain ?? [],
    ...(resource.headers['etag'] === undefined ? {} : { etag: resource.headers['etag'] }),
    ...(resource.headers['last-modified'] === undefined
      ? {}
      : { lastModified: resource.headers['last-modified'] }),
  };
}

function toFetchedContent(
  resource: DownloadedResource,
  decoded: DecodedContent,
  extracted: ExtractedMarkdown,
  contentType: string,
  canonicalUrl: string,
  permanentTarget: string | undefined,
): FetchedContent {
  const redirectChain = resource.redirectChain ?? [];
  return {
    requestedUrl: resource.requestedUrl,
    finalUrl: resource.finalUrl,
    canonicalUrl,
    ...(decoded.title === undefined ? {} : { title: decoded.title }),
    markdown: extracted.markdown,
    documentSections: extractDocumentSections(extracted.markdown),
    contentType,
    fetchedAt: new Date().toISOString(),
    extractionMode: extracted.extractionMode,
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
      ...(permanentTarget === undefined ? {} : { redirectedPermanently: true }),
    },
    links: decoded.links,
  };
}

function remainingTimeoutMs(deadline: number): number {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw new RequestTimeoutError('fetch_url operation deadline exceeded');
  return remaining;
}

async function approveCanonicalUrl(
  candidate: string | undefined,
  fallback: string,
  gateway: SecureHttpGateway,
  context: FetchSecurityContext,
  deadline: number,
): Promise<string> {
  if (candidate === undefined || candidate === fallback) return fallback;
  try {
    if (new URL(candidate).origin === new URL(fallback).origin) return candidate;
    return (await gateway.approveUrl(candidate, context, remainingTimeoutMs(deadline))).value;
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw error;
    return fallback;
  }
}

function validatorsApplyTo(
  requestedUrl: string,
  validators: ContentFetchContext['cacheValidators'],
): boolean {
  if (validators?.validatorUrl === undefined) return false;
  try {
    return new URL(validators.validatorUrl).toString() === new URL(requestedUrl).toString();
  } catch {
    return false;
  }
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
  deadline: number,
): Promise<DecodedContent> {
  if (contentType === 'application/pdf') return decodePdf(resource.body, deadline);
  if (contentType.startsWith('image/')) {
    throw new OcrRequiredNotSupportedError();
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(resource.body).replace(/\0/gu, '');
  if (isHtml(contentType)) return extractHtmlDocument(text, resource.finalUrl);
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

async function decodePdf(body: Uint8Array, deadline: number): Promise<DecodedContent> {
  const decoded = await extractPdfText(body, deadline);
  return { markdown: decoded, links: collectPlainLinks(decoded, 'https://example.invalid/') };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
