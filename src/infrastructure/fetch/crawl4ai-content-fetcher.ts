import { z } from 'zod/v4';

import type { ContentFetcher } from '../../application/ports/content-fetcher.js';
import type { FetchedContent } from '../../domain/models/content.js';
import { ExternalServiceError } from '../../domain/errors/domain-errors.js';
import { fetchJson } from '../http/http-utils.js';

const markdownSchema = z.union([
  z.string(),
  z
    .object({
      raw_markdown: z.string().optional(),
      markdown_with_citations: z.string().optional(),
      fit_markdown: z.string().nullable().optional(),
    })
    .loose(),
]);

const crawlResultSchema = z
  .object({
    url: z.string().optional(),
    redirected_url: z.string().nullable().optional(),
    success: z.boolean().optional().default(true),
    markdown: markdownSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    response_headers: z.record(z.string(), z.unknown()).optional().default({}),
    links: z.unknown().optional(),
    error_message: z.string().optional(),
  })
  .loose();

const envelopeSchema = z
  .object({
    success: z.boolean().optional(),
    results: z.array(crawlResultSchema).optional(),
    result: crawlResultSchema.optional(),
    error: z.string().optional(),
  })
  .loose();

export class Crawl4aiContentFetcher implements ContentFetcher {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly apiToken: string | undefined,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async fetch(url: string): Promise<FetchedContent> {
    const endpoint = new URL('/crawl', ensureTrailingSlash(this.baseUrl));
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.apiToken !== undefined) headers['authorization'] = `Bearer ${this.apiToken}`;

    const json = await fetchJson(
      'crawl4ai',
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls: [url] }),
      },
      this.timeoutMs,
      this.fetchImplementation,
    );

    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
      const direct = crawlResultSchema.safeParse(json);
      if (!direct.success) {
        throw new ExternalServiceError(
          `crawl4ai response does not match its contract: ${envelope.error.message}`,
          'crawl4ai',
        );
      }
      return mapResult(url, direct.data);
    }

    const result = envelope.data.results?.[0] ?? envelope.data.result;
    if (result === undefined) {
      throw new ExternalServiceError(
        envelope.data.error ?? 'crawl4ai returned no result',
        'crawl4ai',
      );
    }
    return mapResult(url, result);
  }
}

function mapResult(url: string, result: z.infer<typeof crawlResultSchema>): FetchedContent {
  if (!result.success) {
    throw new ExternalServiceError(
      result.error_message ?? 'crawl4ai could not fetch the URL',
      'crawl4ai',
    );
  }
  const markdown = extractMarkdown(result.markdown);
  if (markdown.trim() === '') {
    throw new ExternalServiceError('crawl4ai returned no textual content', 'crawl4ai');
  }

  const title = asString(result.metadata['title']);
  const contentType =
    asString(result.response_headers['content-type']) ?? asString(result.metadata['content_type']);
  return {
    requestedUrl: url,
    resolvedUrl: result.redirected_url ?? result.url ?? url,
    ...(title === undefined ? {} : { title }),
    markdown,
    ...(contentType === undefined ? {} : { contentType }),
    metadata: result.metadata,
    links: collectLinks(result.links),
  };
}

function extractMarkdown(value: z.infer<typeof markdownSchema> | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value.raw_markdown ?? value.fit_markdown ?? value.markdown_with_citations ?? '';
}

function collectLinks(value: unknown): readonly string[] {
  const links: string[] = [];
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      if (candidate.startsWith('http://') || candidate.startsWith('https://'))
        links.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate !== null && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      if (typeof record['href'] === 'string') visit(record['href']);
      else if (typeof record['url'] === 'string') visit(record['url']);
      else Object.values(record).forEach(visit);
    }
  };
  visit(value);
  return [...new Set(links)];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
