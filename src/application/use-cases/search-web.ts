import type { CacheRepository } from '../ports/cache-repository.js';
import type { OperationContext, Telemetry } from '../ports/telemetry.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type { SearchProvider, SearchProviderResponse } from '../ports/search-provider.js';
import { createSearchCacheKey, normalizeSearchRequest } from '../services/search-request.js';
import type {
  NormalizedSearchRequest,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../../domain/models/search.js';
import type {
  ToolExecution,
  ToolResponseStatus,
  ToolWarningDescriptor,
} from '../../domain/models/tool-response.js';
import { ApplicationError } from '../../domain/errors/domain-errors.js';
import { SearchQuery } from '../../domain/value-objects/search-query.js';
import {
  matchesDomain,
  rankAndDeduplicate,
  toSearchResult,
} from '../../domain/services/result-ranking.js';

export interface SearchWebOptions {
  readonly cacheTtlMs: number;
  readonly providerOversampling: number;
  readonly maxSnippetChars: number;
}

interface CachedSearchValue {
  readonly status: ToolResponseStatus;
  readonly warnings: readonly ToolWarningDescriptor[];
  readonly data: SearchResponse;
}

export class SearchWeb {
  public constructor(
    private readonly provider: SearchProvider,
    private readonly cache: CacheRepository,
    private readonly officialSources: OfficialSourceRegistry,
    private readonly options: SearchWebOptions,
    private readonly telemetry?: Telemetry,
  ) {}

  public async execute(
    request: SearchRequest,
    context: OperationContext = {},
  ): Promise<ToolExecution<SearchResponse>> {
    const normalizedRequest = normalizeSearchRequest(request);
    const key = createSearchCacheKey(normalizedRequest, this.officialSources.version(), {
      providerOversampling: this.options.providerOversampling,
      maxSnippetChars: this.options.maxSnippetChars,
    });
    const cached = await this.cache.getSearch<CachedSearchValue>(key, { allowStale: true });

    if (cached !== undefined && !cached.stale) {
      this.telemetry?.record('cache_hit', {
        requestId: context.requestId,
        tool: 'search_web',
        cache: 'search',
      });
      return execution(cached.value, 'HIT');
    }
    this.telemetry?.record('cache_miss', {
      requestId: context.requestId,
      tool: 'search_web',
      cache: 'search',
      staleAvailable: cached !== undefined,
    });

    let firstResponse: SearchProviderResponse;
    let providerResponse: SearchProviderResponse;
    let shouldFallback: boolean;
    try {
      firstResponse = await this.searchProvider(
        normalizedRequest,
        normalizedRequest.language,
        context,
      );
      shouldFallback =
        firstResponse.results.length === 0 &&
        !normalizedRequest.language.toLowerCase().startsWith('en');
      providerResponse = shouldFallback
        ? await this.searchProvider(normalizedRequest, 'en', context)
        : firstResponse;
    } catch (error) {
      if (cached !== undefined && isTransientProviderError(error)) {
        this.telemetry?.record('cache_hit', {
          requestId: context.requestId,
          tool: 'search_web',
          cache: 'search',
          stale: true,
        });
        return staleExecution(cached.value);
      }
      throw error;
    }
    const candidates = providerResponse.results
      .map((result) => {
        const officialSource = this.officialSources.findByUrl(result.url);
        const mapped = toSearchResult(result, {
          query: normalizedRequest.query,
          ...(officialSource === undefined ? {} : { officialSource }),
        });
        if (mapped === undefined) return undefined;
        return {
          ...mapped,
          snippet: truncate(mapped.snippet, this.options.maxSnippetChars),
        };
      })
      .filter((result) => result !== undefined)
      .filter((result) => !matchesDomain(result.domain, normalizedRequest.excludedDomains))
      .filter(
        (result) =>
          normalizedRequest.allowedDomains.length === 0 ||
          matchesDomain(result.domain, normalizedRequest.allowedDomains),
      );

    const policyCandidates = applySourcePolicy(candidates, normalizedRequest.sourcePolicy);
    const ranked = rankAndDeduplicate(policyCandidates);
    const results = ranked.slice(0, normalizedRequest.maxResults);
    const unresponsiveEngines = mergeUnresponsiveEngines(firstResponse, providerResponse);
    const warnings = createWarnings({
      request: normalizedRequest,
      fallbackLanguageUsed: shouldFallback,
      candidates,
      ranked,
      results,
      unresponsiveEngines,
    });
    const value: CachedSearchValue = {
      status: warnings.some((warning) =>
        [
          'FALLBACK_LANGUAGE_USED',
          'RESULTS_TRUNCATED',
          'DATE_UNAVAILABLE',
          'SEARCH_PROVIDER_PARTIAL_FAILURE',
        ].includes(warning.code),
      )
        ? 'partial'
        : 'success',
      warnings,
      data: {
        query: normalizedRequest.query,
        results,
        metadata: {
          total: providerResponse.total ?? candidates.length,
          returned: results.length,
          unresponsiveEngines,
        },
      },
    };

    const stored = await this.cache.setSearch(key, value, this.options.cacheTtlMs);
    return execution(value, stored ? 'MISS' : 'DISABLED');
  }

  private async searchProvider(
    request: NormalizedSearchRequest,
    language: string,
    context: OperationContext,
  ): Promise<SearchProviderResponse> {
    const startedAt = performance.now();
    try {
      const response = await this.provider.search({
        query: SearchQuery.create(request.query),
        language,
        ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
        maxResults: request.maxResults * this.options.providerOversampling,
      });
      this.telemetry?.record('provider_called', {
        requestId: context.requestId,
        tool: 'search_web',
        provider: 'searxng',
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        status: 'success',
        resultCount: response.results.length,
        unresponsiveEngineCount: response.unresponsiveEngines.length,
      });
      return response;
    } catch (error) {
      this.telemetry?.record('provider_failed', {
        requestId: context.requestId,
        tool: 'search_web',
        provider: 'searxng',
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        status: 'failed',
        code: error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR',
      });
      throw error;
    }
  }
}

function applySourcePolicy(
  results: readonly SearchResult[],
  sourcePolicy: NormalizedSearchRequest['sourcePolicy'],
): readonly SearchResult[] {
  return sourcePolicy === 'strict'
    ? results.filter((result) => result.sourceStatus === 'VERIFIED_OFFICIAL')
    : results;
}

function createWarnings(context: {
  readonly request: NormalizedSearchRequest;
  readonly fallbackLanguageUsed: boolean;
  readonly candidates: readonly SearchResult[];
  readonly ranked: readonly SearchResult[];
  readonly results: readonly SearchResult[];
  readonly unresponsiveEngines: readonly string[];
}): readonly ToolWarningDescriptor[] {
  const warnings: ToolWarningDescriptor[] = [];
  if (context.fallbackLanguageUsed) {
    warnings.push({
      code: 'FALLBACK_LANGUAGE_USED',
      message: `No result was found in ${context.request.language}; English fallback was used`,
    });
  }
  if (context.results.length === 0) {
    if (context.request.sourcePolicy === 'strict' && context.candidates.length > 0) {
      warnings.push({
        code: 'NO_VERIFIED_OFFICIAL_SOURCE',
        message: 'No verified official source matched the strict policy',
      });
    } else {
      warnings.push({ code: 'NO_RESULTS', message: 'No search result matched the request' });
    }
  }
  if (
    context.request.sourcePolicy === 'prefer' &&
    context.results.some((result) => result.sourceStatus !== 'VERIFIED_OFFICIAL')
  ) {
    warnings.push({
      code: 'NON_OFFICIAL_RESULTS_INCLUDED',
      message: 'The response includes results that are not verified as official',
    });
  }
  if (context.ranked.length > context.results.length) {
    warnings.push({
      code: 'RESULTS_TRUNCATED',
      message: `Results were limited to ${context.request.maxResults}`,
    });
  }
  if (
    context.results.length > 0 &&
    context.results.every(
      (result) => result.publishedAt === undefined && result.updatedAt === undefined,
    )
  ) {
    warnings.push({
      code: 'DATE_UNAVAILABLE',
      message: 'The active search engines did not provide a publication or update date',
    });
  }
  if (context.unresponsiveEngines.length > 0) {
    warnings.push({
      code: 'SEARCH_PROVIDER_PARTIAL_FAILURE',
      message: 'One or more SearXNG engines were unavailable',
    });
  }
  return warnings;
}

function execution(
  value: CachedSearchValue,
  cacheStatus: 'HIT' | 'MISS' | 'DISABLED',
): ToolExecution<SearchResponse> {
  return {
    status: value.status,
    warnings: value.warnings,
    cacheStatus,
    provider: 'searxng',
    data: value.data,
  };
}

function staleExecution(value: CachedSearchValue): ToolExecution<SearchResponse> {
  return {
    ...execution(value, 'MISS'),
    status: 'partial',
    cacheStatus: 'STALE_FALLBACK',
    warnings: [
      ...value.warnings,
      {
        code: 'STALE_CACHE_USED',
        message: 'An expired search response was used because the provider is unavailable',
      },
    ],
  };
}

function isTransientProviderError(error: unknown): boolean {
  return (
    error instanceof ApplicationError &&
    ['SEARCH_PROVIDER_UNAVAILABLE', 'REQUEST_TIMEOUT', 'HTTP_ERROR'].includes(error.code)
  );
}

function mergeUnresponsiveEngines(
  first: SearchProviderResponse,
  final: SearchProviderResponse,
): readonly string[] {
  return [...new Set([...first.unresponsiveEngines, ...final.unresponsiveEngines])].sort(
    compareText,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
