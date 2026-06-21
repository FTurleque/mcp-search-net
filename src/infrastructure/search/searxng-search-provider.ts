import { z } from 'zod/v4';

import type {
  SearchProvider,
  SearchProviderRequest,
  SearchProviderResponse,
} from '../../application/ports/search-provider.js';
import { ExternalServiceError } from '../../domain/errors/domain-errors.js';
import { fetchJson } from '../http/http-utils.js';

const resultSchema = z
  .object({
    title: z.string().optional().default(''),
    url: z.string(),
    content: z.string().optional().default(''),
    engine: z.string().optional(),
    engines: z.array(z.string()).optional(),
    score: z.number().optional(),
    publishedDate: z.union([z.string(), z.date()]).nullish(),
    pubdate: z.string().nullish(),
    updatedDate: z.union([z.string(), z.date()]).nullish(),
    language: z.string().nullish(),
    lang: z.string().nullish(),
  })
  .loose();

const responseSchema = z
  .object({
    results: z.array(resultSchema),
    number_of_results: z.number().optional(),
    unresponsive_engines: z
      .array(z.union([z.string(), z.tuple([z.string(), z.string()])]))
      .optional()
      .default([]),
  })
  .loose();

export class SearxngSearchProvider implements SearchProvider {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async search(request: SearchProviderRequest): Promise<SearchProviderResponse> {
    const endpoint = new URL('/search', ensureTrailingSlash(this.baseUrl));
    endpoint.searchParams.set('q', request.query);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('categories', 'general');
    endpoint.searchParams.set('safesearch', '1');
    if (request.language !== undefined) endpoint.searchParams.set('language', request.language);
    if (request.timeRange !== undefined) endpoint.searchParams.set('time_range', request.timeRange);

    const json = await fetchJson(
      'searxng',
      endpoint,
      { method: 'GET', headers: { accept: 'application/json' } },
      this.timeoutMs,
      this.fetchImplementation,
    );
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ExternalServiceError('searxng response does not match its contract', 'searxng', {
        cause: parsed.error,
      });
    }

    return {
      results: parsed.data.results.slice(0, request.limit).map((result) => {
        const publishedAt = toPublishedAt(result.publishedDate ?? result.pubdate);
        const updatedAt = toPublishedAt(result.updatedDate);
        const detectedLanguage = result.language ?? result.lang ?? undefined;
        return {
          title: decodeSnippet(result.title),
          url: result.url,
          snippet: decodeSnippet(result.content),
          ...(result.score === undefined ? {} : { score: result.score }),
          engines: result.engines ?? (result.engine === undefined ? [] : [result.engine]),
          ...(publishedAt === undefined ? {} : { publishedAt }),
          ...(updatedAt === undefined ? {} : { updatedAt }),
          ...(detectedLanguage === undefined ? {} : { detectedLanguage }),
        };
      }),
      ...(parsed.data.number_of_results === undefined
        ? {}
        : { total: parsed.data.number_of_results }),
      unresponsiveEngines: parsed.data.unresponsive_engines.map((entry) =>
        typeof entry === 'string' ? entry : entry[0],
      ),
    };
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function decodeSnippet(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toPublishedAt(value: string | Date | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
