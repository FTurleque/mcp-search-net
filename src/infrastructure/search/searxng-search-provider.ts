import { z } from 'zod/v4';

import type {
  SearchProvider,
  SearchProviderRequest,
  SearchProviderResponse,
} from '../../application/ports/search-provider.js';
import {
  ExternalServiceError,
  HttpError,
  isTransientHttpStatus,
  RequestTimeoutError,
  SearchProviderUnavailableError,
} from '../../domain/errors/domain-errors.js';
import {
  countUnicodeCharacters,
  MAX_EXTERNAL_ENGINE_NAME_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';
import { fetchJson } from '../http/http-utils.js';

const MAX_PROVIDER_SNIPPET_CHARACTERS = 4_096;
const MAX_PROVIDER_ENGINES = 32;

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
    const deadline = Date.now() + this.timeoutMs;
    const endpoint = new URL('/search', ensureTrailingSlash(this.baseUrl));
    endpoint.searchParams.set('q', request.query.value);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('categories', 'general');
    endpoint.searchParams.set('safesearch', '1');
    endpoint.searchParams.set('pageno', '1');
    if (request.language !== undefined) endpoint.searchParams.set('language', request.language);
    if (request.timeRange !== undefined) endpoint.searchParams.set('time_range', request.timeRange);

    const json = await this.requestJson(endpoint, deadline);
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ExternalServiceError('searxng response does not match its contract', 'searxng', {
        cause: parsed.error,
      });
    }

    return {
      results: parsed.data.results.slice(0, request.maxResults).map((result) => {
        const publishedAt = toPublishedAt(result.publishedDate ?? result.pubdate);
        const updatedAt = toPublishedAt(result.updatedDate);
        const detectedLanguage = normalizeDetectedLanguage(
          result.language ?? result.lang ?? undefined,
        );
        const engines = result.engines ?? (result.engine === undefined ? [] : [result.engine]);
        return {
          title: truncateUnicode(decodeSnippet(result.title), MAX_EXTERNAL_TITLE_CHARACTERS),
          url: result.url,
          snippet: truncateUnicode(decodeSnippet(result.content), MAX_PROVIDER_SNIPPET_CHARACTERS),
          ...(result.score === undefined ? {} : { score: result.score }),
          engines: engines
            .slice(0, MAX_PROVIDER_ENGINES)
            .map((engine) => truncateUnicode(engine, MAX_EXTERNAL_ENGINE_NAME_CHARACTERS)),
          ...(publishedAt === undefined ? {} : { publishedAt }),
          ...(updatedAt === undefined ? {} : { updatedAt }),
          ...(detectedLanguage === undefined ? {} : { detectedLanguage }),
        };
      }),
      ...(parsed.data.number_of_results === undefined
        ? {}
        : { total: parsed.data.number_of_results }),
      unresponsiveEngines: parsed.data.unresponsive_engines
        .slice(0, MAX_PROVIDER_ENGINES)
        .map((entry) => (typeof entry === 'string' ? entry : entry[0]))
        .map((engine) => truncateUnicode(engine, MAX_EXTERNAL_ENGINE_NAME_CHARACTERS)),
    };
  }

  private async requestJson(endpoint: URL, deadline: number): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new RequestTimeoutError('searxng search deadline exceeded');
      try {
        return await fetchJson(
          'searxng',
          endpoint,
          { method: 'GET', headers: { accept: 'application/json' } },
          remaining,
          this.fetchImplementation,
        );
      } catch (error) {
        const retryable =
          error instanceof HttpError &&
          error.status !== undefined &&
          isTransientHttpStatus(error.status);
        if (retryable && attempt === 0) continue;
        if (error instanceof HttpError) {
          throw new SearchProviderUnavailableError(
            'searxng rejected the search request',
            error.status,
            { cause: error },
          );
        }
        throw error;
      }
    }
    throw new SearchProviderUnavailableError();
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

function normalizeDetectedLanguage(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const candidate = value.trim();
  if (candidate === '' || countUnicodeCharacters(candidate) > MAX_EXTERNAL_LANGUAGE_CHARACTERS) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(candidate)[0];
  } catch {
    return undefined;
  }
}

function toPublishedAt(value: string | Date | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
