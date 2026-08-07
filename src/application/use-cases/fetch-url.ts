import { createHash } from 'node:crypto';

import type { CacheRepository } from '../ports/cache-repository.js';
import type { OperationContext, Telemetry } from '../ports/telemetry.js';
import type { ContentFetcher } from '../ports/content-fetcher.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type { UrlSecurityPolicy } from '../ports/url-security-policy.js';
import type { FetchRequest, FetchResponse, FetchedContent } from '../../domain/models/content.js';
import { ApplicationError, InternalApplicationError } from '../../domain/errors/domain-errors.js';
import type { SourceStatus } from '../../domain/models/search.js';
import type { ToolExecution, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import { selectRelevantContent } from '../../domain/services/content-selection.js';
import { WebUrl } from '../../domain/value-objects/web-url.js';

const MIN_LINK_INSPECTION_BUDGET = 32;
const LINK_INSPECTION_MULTIPLIER = 4;
const MAX_LINK_VALIDATION_MS = 2_000;

export interface FetchUrlOptions {
  readonly documentationTtlMs: number;
  readonly readmeTtlMs: number;
  readonly sitemapTtlMs: number;
  readonly maxLinks: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
}

export class FetchUrl {
  public constructor(
    private readonly fetcher: ContentFetcher,
    private readonly cache: CacheRepository,
    private readonly securityPolicy: UrlSecurityPolicy,
    private readonly officialSources: OfficialSourceRegistry,
    private readonly options: FetchUrlOptions,
    private readonly telemetry?: Telemetry,
  ) {}

  public async execute(
    request: FetchRequest,
    context: OperationContext = {},
  ): Promise<ToolExecution<FetchResponse>> {
    const securityContext = {
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      tool: 'fetch_url' as const,
    };
    const requestedUrl = WebUrl.createTransport(request.url);
    const approved = await this.securityPolicy.assertAllowed(requestedUrl.value, securityContext);
    const cacheIdentity = WebUrl.create(approved.value).value;
    const key = createHash('sha256')
      .update(
        JSON.stringify({ url: cacheIdentity, renderMode: request.renderMode, contractVersion: 4 }),
      )
      .digest('hex');
    const cached = await this.cache.getContent<FetchedContent>(key, { allowStale: true });
    let content: FetchedContent;
    let cacheStatus: ToolExecution<FetchResponse>['cacheStatus'];
    let staleFallback = false;
    if (cached !== undefined && !cached.stale) {
      this.telemetry?.record('cache_hit', {
        requestId: context.requestId,
        tool: 'fetch_url',
        cache: 'content',
      });
      content = cached.value;
      cacheStatus = 'HIT';
    } else {
      this.telemetry?.record('cache_miss', {
        requestId: context.requestId,
        tool: 'fetch_url',
        cache: 'content',
        staleAvailable: cached !== undefined,
      });
      const startedAt = performance.now();
      try {
        const fetched = await this.fetcher.fetch(
          {
            url: WebUrl.createTransport(approved.value),
            renderMode: request.renderMode,
            timeoutMs: this.options.timeoutMs,
            maxResponseBytes: this.options.maxResponseBytes,
            maxRedirects: this.options.maxRedirects,
          },
          {
            ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
            cacheValidators: {
              ...(cached?.etag === undefined ? {} : { etag: cached.etag }),
              ...(cached?.lastModified === undefined ? {} : { lastModified: cached.lastModified }),
              ...(cached?.contentHash === undefined ? {} : { contentHash: cached.contentHash }),
            },
          },
        );
        this.telemetry?.record('provider_called', {
          requestId: context.requestId,
          tool: 'fetch_url',
          provider: 'crawl4ai',
          domain: approved.hostname,
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          status: 'success',
          notModified: 'notModified' in fetched,
          statusCode: 'notModified' in fetched ? 304 : fetched.statusCode,
          inputBytes:
            'notModified' in fetched || typeof fetched.metadata['bytes'] !== 'number'
              ? undefined
              : fetched.metadata['bytes'],
        });
        content = 'notModified' in fetched ? requireCachedValue(cached) : fetched;
        cacheStatus = 'notModified' in fetched ? 'HIT' : 'MISS';
        const stored = await this.cache.setContent(key, content, cacheTtl(content, this.options), {
          ...(content.etag === undefined ? {} : { etag: content.etag }),
          ...(content.lastModified === undefined ? {} : { lastModified: content.lastModified }),
          contentHash: content.contentHash,
        });
        if (!stored) cacheStatus = 'DISABLED';
      } catch (error) {
        this.telemetry?.record('provider_failed', {
          requestId: context.requestId,
          tool: 'fetch_url',
          provider: 'crawl4ai',
          domain: approved.hostname,
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          status: 'failed',
          code: error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR',
        });
        if (cached === undefined || !isTransientProviderError(error)) throw error;
        content = cached.value;
        cacheStatus = 'STALE_FALLBACK';
        staleFallback = true;
        this.telemetry?.record('cache_hit', {
          requestId: context.requestId,
          tool: 'fetch_url',
          cache: 'content',
          stale: true,
        });
      }
    }
    const final = await this.securityPolicy.assertAllowed(content.finalUrl, securityContext);
    const canonical = await safeApprovedUrl(
      content.canonicalUrl,
      final.value,
      this.securityPolicy,
      securityContext,
    );

    const selected = selectRelevantContent(
      content.markdown,
      request.query,
      request.maxCharacters,
      request.maxSections,
    );
    const links = await filterApprovedLinks(
      content.links,
      this.options.maxLinks,
      this.securityPolicy,
      securityContext,
    );
    const sourceStatus = classifySource(final.value, this.officialSources);
    const data: FetchResponse = {
      requestedUrl: approved.value,
      finalUrl: final.value,
      canonicalUrl: canonical,
      domain: final.hostname,
      ...(content.title === undefined ? {} : { title: content.title }),
      contentType: content.contentType,
      sourceStatus,
      fetchedAt: content.fetchedAt,
      extractionMode: content.extractionMode,
      truncated: selected.truncated,
      sectionCount: selected.sections.length,
      sections: selected.sections,
      markdown: selected.markdown,
      links,
    };
    const warnings: ToolWarningDescriptor[] = [];
    if (staleFallback)
      warnings.push({
        code: 'STALE_CACHE_USED',
        message: 'Expired content was used because the content provider is unavailable',
      });
    if (final.value !== approved.value)
      warnings.push({
        code: 'REDIRECTED_URL',
        message: 'The final URL differs from the requested URL',
      });
    if (content.extractionMode === 'native-render')
      warnings.push({
        code: 'JAVASCRIPT_FALLBACK_USED',
        message: 'Native rendering was used after static extraction was insufficient',
      });
    if (selected.noRelevantSection)
      warnings.push({
        code: 'NO_RELEVANT_SECTION',
        message: 'No section matched the requested query',
      });
    if (selected.truncated)
      this.telemetry?.record('content_truncated', {
        requestId: context.requestId,
        tool: 'fetch_url',
        domain: final.hostname,
        sectionCount: selected.sections.length,
        outputCharacters: selected.markdown.length,
      });
    if (selected.truncated)
      warnings.push({
        code: 'CONTENT_TRUNCATED',
        message: 'The extracted content was truncated by the global budget',
      });
    if (selected.sectionTruncated)
      warnings.push({
        code: 'SECTION_TRUNCATED',
        message: 'At least one section exceeded the per-section budget',
      });
    if (sourceStatus !== 'VERIFIED_OFFICIAL')
      warnings.push({
        code: 'UNVERIFIED_SOURCE',
        message: 'The fetched URL is not a verified official source',
      });
    return {
      status: warnings.length === 0 ? 'success' : 'partial',
      warnings,
      cacheStatus,
      provider:
        content.extractionMode === 'native-render' ? 'secure-gateway+crawl4ai' : 'secure-gateway',
      data,
    };
  }
}

function requireCachedValue(
  record: { readonly value: FetchedContent } | undefined,
): FetchedContent {
  if (record === undefined)
    throw new InternalApplicationError('A 304 response requires a cached value');
  return record.value;
}

function cacheTtl(content: FetchedContent, options: FetchUrlOptions): number {
  const path = new URL(content.finalUrl).pathname.toLowerCase();
  if (path.endsWith('/readme') || /\/readme(?:\.[a-z0-9]+)?$/u.test(path))
    return options.readmeTtlMs;
  if (path.endsWith('/sitemap.xml')) return options.sitemapTtlMs;
  return options.documentationTtlMs;
}

function isTransientProviderError(error: unknown): boolean {
  return (
    error instanceof ApplicationError &&
    ['CONTENT_PROVIDER_UNAVAILABLE', 'REQUEST_TIMEOUT', 'HTTP_ERROR'].includes(error.code)
  );
}

async function safeApprovedUrl(
  value: string,
  fallback: string,
  policy: UrlSecurityPolicy,
  context: NonNullable<Parameters<UrlSecurityPolicy['assertAllowed']>[1]>,
): Promise<string> {
  try {
    return (await policy.assertAllowed(value, context)).value;
  } catch {
    return fallback;
  }
}

async function filterApprovedLinks(
  values: readonly string[],
  maximum: number,
  policy: UrlSecurityPolicy,
  context: NonNullable<Parameters<UrlSecurityPolicy['assertAllowed']>[1]>,
): Promise<readonly string[]> {
  const accepted: string[] = [];
  const uniqueValues = [...new Set(values)];
  const maximumInspections = Math.max(MIN_LINK_INSPECTION_BUDGET, maximum * LINK_INSPECTION_MULTIPLIER);
  const deadline = Date.now() + MAX_LINK_VALIDATION_MS;
  let inspected = 0;

  for (const value of uniqueValues) {
    if (accepted.length >= maximum || inspected >= maximumInspections || Date.now() >= deadline) break;
    inspected += 1;
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      accepted.push((await withTimeout(policy.assertAllowed(value, context), remaining)).value);
    } catch {
      /* Blocked, invalid and over-budget links are never exposed. */
    }
  }
  return accepted;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('LINK_VALIDATION_TIMEOUT')), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function classifySource(url: string, registry: OfficialSourceRegistry): SourceStatus {
  if (registry.findByUrl(url) !== undefined) return 'VERIFIED_OFFICIAL';
  const parsed = new URL(url);
  if (
    parsed.hostname.startsWith('docs.') ||
    parsed.pathname
      .split('/')
      .some((part) => ['docs', 'documentation', 'reference'].includes(part.toLowerCase()))
  ) {
    return 'LIKELY_OFFICIAL';
  }
  return 'UNKNOWN';
}
