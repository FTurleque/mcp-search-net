import { createHash } from 'node:crypto';

import type { CacheRepository } from '../ports/cache-repository.js';
import type { Clock } from '../ports/clock.js';
import type { ContentFetcher } from '../ports/content-fetcher.js';
import type { UrlSecurityPolicy } from '../ports/url-security-policy.js';
import type { FetchRequest, FetchResponse, FetchedContent } from '../../domain/models/content.js';
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
    private readonly clock: Clock,
    private readonly options: FetchUrlOptions,
  ) {}

  public async execute(request: FetchRequest): Promise<FetchResponse> {
    const approved = await this.securityPolicy.assertAllowed(request.url);
    const key = createHash('sha256').update(approved.value).digest('hex');
    const cached = await this.cache.get<FetchedContent>('fetch', key);

    const content = cached?.value ?? (await this.fetcher.fetch(approved.value));
    await this.securityPolicy.assertAllowed(content.resolvedUrl);

    if (cached === undefined) {
      await this.cache.set('fetch', key, content, this.options.cacheTtlMs);
    }

    const selected = selectRelevantContent(content.markdown, request.query, request.maxChars);
    return {
      url: approved.value,
      resolvedUrl: content.resolvedUrl,
      ...(content.title === undefined ? {} : { title: content.title }),
      markdown: selected.markdown,
      sectionHeadings: selected.sectionHeadings,
      metadata: {
        ...(content.contentType === undefined ? {} : { contentType: content.contentType }),
        fetchedAt: this.clock.now().toISOString(),
        cached: cached !== undefined,
        truncated: selected.truncated,
        wordCount: countWords(selected.markdown),
        links: [...new Set(content.links)].slice(0, this.options.maxLinks),
        source: content.metadata,
      },
    };
  }
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}
