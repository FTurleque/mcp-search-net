import type { CacheRepository } from '../ports/cache-repository.js';
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
  ) {}

  public async execute(request: SearchRequest): Promise<ToolExecution<SearchResponse>> {
    const normalizedRequest = normalizeSearchRequest(request);
    const key = createSearchCacheKey(normalizedRequest, this.officialSources.version(), {
      providerOversampling: this.options.providerOversampling,
      maxSnippetChars: this.options.maxSnippetChars,
    });
    const cached = await this.cache.get<CachedSearchValue>('search', key);

    if (cached !== undefined) {
      return execution(cached.value, 'HIT');
    }

    const firstResponse = await this.searchProvider(normalizedRequest, normalizedRequest.language);
    const shouldFallback =
      firstResponse.results.length === 0 &&
      !normalizedRequest.language.toLowerCase().startsWith('en');
    const providerResponse = shouldFallback
      ? await this.searchProvider(normalizedRequest, 'en')
      : firstResponse;

    const candidates = providerResponse.results
      .map((result) => {
        const officialSource = this.officialSources.findByUrl(result.url);
        const mapped = toSearchResult(result, {
          query: normalizedRequest.query,
          ...(officialSource === undefined ? {} : { officialSource }),
          allowedDomains: normalizedRequest.allowedDomains,
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
    const warnings = createWarnings({
      request: normalizedRequest,
      fallbackLanguageUsed: shouldFallback,
      candidates,
      ranked,
      results,
    });
    const value: CachedSearchValue = {
      status: warnings.some((warning) =>
        ['FALLBACK_LANGUAGE_USED', 'RESULTS_TRUNCATED'].includes(warning.code),
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
          unresponsiveEngines: mergeUnresponsiveEngines(firstResponse, providerResponse),
        },
      },
    };

    await this.cache.set('search', key, value, this.options.cacheTtlMs);
    return execution(value, 'MISS');
  }

  private searchProvider(
    request: NormalizedSearchRequest,
    language: string,
  ): Promise<SearchProviderResponse> {
    return this.provider.search({
      query: request.query,
      language,
      ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
      limit: request.maxResults * this.options.providerOversampling,
    });
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
  return warnings;
}

function execution(
  value: CachedSearchValue,
  cacheStatus: 'HIT' | 'MISS',
): ToolExecution<SearchResponse> {
  return {
    status: value.status,
    warnings: value.warnings,
    cacheStatus,
    provider: 'searxng',
    data: value.data,
  };
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
