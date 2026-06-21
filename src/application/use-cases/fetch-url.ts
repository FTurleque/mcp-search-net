import { createHash } from 'node:crypto';

import type { CacheRepository } from '../ports/cache-repository.js';
import type { ContentFetcher } from '../ports/content-fetcher.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type { UrlSecurityPolicy } from '../ports/url-security-policy.js';
import type { FetchRequest, FetchResponse, FetchedContent } from '../../domain/models/content.js';
import type { SourceStatus } from '../../domain/models/search.js';
import type { ToolExecution, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import { selectRelevantContent } from '../../domain/services/content-selection.js';

export interface FetchUrlOptions {
  readonly cacheTtlMs: number;
  readonly maxLinks: number;
}

export class FetchUrl {
  public constructor(
    private readonly fetcher: ContentFetcher,
    private readonly cache: CacheRepository,
    private readonly securityPolicy: UrlSecurityPolicy,
    private readonly officialSources: OfficialSourceRegistry,
    private readonly options: FetchUrlOptions,
  ) {}

  public async execute(request: FetchRequest): Promise<ToolExecution<FetchResponse>> {
    const approved = await this.securityPolicy.assertAllowed(request.url);
    const key = createHash('sha256')
      .update(
        JSON.stringify({ url: approved.value, renderMode: request.renderMode, contractVersion: 3 }),
      )
      .digest('hex');
    const cached = await this.cache.get<FetchedContent>('fetch', key);
    const content = cached?.value ?? (await this.fetcher.fetch(approved.value, request.renderMode));
    const final = await this.securityPolicy.assertAllowed(content.finalUrl);
    const canonical = await safeApprovedUrl(content.canonicalUrl, final.value, this.securityPolicy);

    if (cached === undefined) await this.cache.set('fetch', key, content, this.options.cacheTtlMs);

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
      cacheStatus: cached === undefined ? 'MISS' : 'HIT',
      provider:
        content.extractionMode === 'native-render' ? 'secure-gateway+crawl4ai' : 'secure-gateway',
      data,
    };
  }
}

async function safeApprovedUrl(
  value: string,
  fallback: string,
  policy: UrlSecurityPolicy,
): Promise<string> {
  try {
    return (await policy.assertAllowed(value)).value;
  } catch {
    return fallback;
  }
}

async function filterApprovedLinks(
  values: readonly string[],
  maximum: number,
  policy: UrlSecurityPolicy,
): Promise<readonly string[]> {
  const accepted: string[] = [];
  for (const value of [...new Set(values)]) {
    if (accepted.length >= maximum) break;
    try {
      accepted.push((await policy.assertAllowed(value)).value);
    } catch {
      /* Blocked links are never exposed. */
    }
  }
  return accepted;
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
