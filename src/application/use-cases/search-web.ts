import type { CacheRepository } from '../ports/cache-repository.js';
import type { OperationContext, Telemetry } from '../ports/telemetry.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type { SearchProvider, SearchProviderResponse } from '../ports/search-provider.js';
import {
  decodeSearchCacheValue,
  type SearchCacheValue,
} from '../services/cache-value-validation.js';
import { createSearchCacheKey, normalizeSearchRequest } from '../services/search-request.js';
import type {
  NormalizedSearchRequest,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../../domain/models/search.js';
import type { ToolExecution, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import {
  ApplicationError,
  HttpError,
  isTransientHttpStatus,
  RequestTimeoutError,
  SearchProviderUnavailableError,
} from '../../domain/errors/domain-errors.js';
import {
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';
import { SearchQuery } from '../../domain/value-objects/search-query.js';
import {
  matchesDomain,
  rankAndDeduplicate,
  toSearchResult,
} from '../../domain/services/result-ranking.js';

const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;
const EMPTY_PROVIDER_RESPONSE: SearchProviderResponse = {
  results: [],
  total: 0,
  unresponsiveEngines: [],
};

export interface SearchWebOptions {
  readonly cacheTtlMs: number;
  readonly providerOversampling: number;
  readonly maxSnippetChars: number;
  readonly providerTimeoutMs?: number;
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
    const cached = await this.cache.getSearch<SearchCacheValue>(key, {
      allowStale: true,
      decode: decodeSearchCacheValue,
    });

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
    const deadline = Date.now() + (this.options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
    const domainConstraints =
      normalizedRequest.sourcePolicy === 'strict'
        ? strictOfficialDomains(normalizedRequest, this.officialSources)
        : undefined;
    try {
      if (domainConstraints !== undefined && domainConstraints.length === 0) {
        firstResponse = EMPTY_PROVIDER_RESPONSE;
        providerResponse = firstResponse;
        shouldFallback = false;
      } else {
        firstResponse = await this.searchProvider(
          normalizedRequest,
          normalizedRequest.language,
          context,
          deadline,
          domainConstraints,
        );
        shouldFallback =
          firstResponse.results.length === 0 &&
          !normalizedRequest.language.toLowerCase().startsWith('en');
        providerResponse = shouldFallback
          ? await this.searchProvider(normalizedRequest, 'en', context, deadline, domainConstraints)
          : firstResponse;
      }
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
          title: truncateUnicode(mapped.title, MAX_EXTERNAL_TITLE_CHARACTERS),
          snippet: truncateUnicode(mapped.snippet, this.options.maxSnippetChars),
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
    const value: SearchCacheValue = {
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
          sourceProvider: 'searxng',
          retrievedAt: new Date().toISOString(),
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
    deadline: number,
    domainConstraints?: readonly string[],
  ): Promise<SearchProviderResponse> {
    const startedAt = performance.now();
    try {
      const response = await withDeadline(
        this.provider.search({
          query: SearchQuery.create(request.query),
          language,
          ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
          maxResults: request.maxResults * this.options.providerOversampling,
          ...(domainConstraints === undefined ? {} : { domainConstraints }),
          deadlineMs: deadline,
        }),
        deadline,
      );
      this.telemetry?.record('provider_called', {
        requestId: context.requestId,
        tool: 'search_web',
        provider: 'searxng',
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        status: 'success',
        resultCount: response.results.length,
        unresponsiveEngineCount: response.unresponsiveEngines.length,
        constrainedDomainCount: domainConstraints?.length ?? 0,
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
        constrainedDomainCount: domainConstraints?.length ?? 0,
      });
      throw error;
    }
  }
}

function strictOfficialDomains(
  request: NormalizedSearchRequest,
  registry: OfficialSourceRegistry,
): readonly string[] {
  const prioritized = [...registry.findForQuery(request.query), ...registry.list()];
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const source of prioritized) {
    if (!source.enabled) continue;
    const domain = source.domain.toLowerCase().replace(/\.$/u, '');
    if (seen.has(domain)) continue;
    if (matchesDomain(domain, request.excludedDomains)) continue;
    if (
      request.allowedDomains.length > 0 &&
      !matchesDomain(domain, request.allowedDomains) &&
      !request.allowedDomains.some((allowed) => matchesDomain(allowed, [domain]))
    ) {
      continue;
    }
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
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
    if (context.request.sourcePolicy === 'strict') {
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
  value: SearchCacheValue,
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

function staleExecution(value: SearchCacheValue): ToolExecution<SearchResponse> {
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
  if (error instanceof RequestTimeoutError) return true;
  if (error instanceof SearchProviderUnavailableError) {
    return error.status === undefined || isTransientHttpStatus(error.status);
  }
  if (error instanceof HttpError) {
    return error.status === undefined || isTransientHttpStatus(error.status);
  }
  return error instanceof ApplicationError && error.code === 'SEARCH_PROVIDER_UNAVAILABLE';
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

async function withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RequestTimeoutError('search_web provider deadline exceeded');
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new RequestTimeoutError('search_web provider deadline exceeded')),
      remaining,
    );
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
