import type { CacheRepository } from '../ports/cache-repository.js';
import type { OperationContext, Telemetry } from '../ports/telemetry.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type {
  SearchDomainConstraint,
  SearchProvider,
  SearchProviderResponse,
} from '../ports/search-provider.js';
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
import type { OfficialSource } from '../../domain/models/official-source.js';
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
  normalizeResultUrl,
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

    let responses: SearchProviderResponse[];
    let shouldFallback: boolean;
    const deadline = Date.now() + (this.options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
    try {
      if (normalizedRequest.sourcePolicy === 'strict') {
        const collected: SearchProviderResponse[] = [];
        const targetedSources = targetedOfficialSources(normalizedRequest, this.officialSources);
        const targetedConstraints = toDomainConstraints(targetedSources);
        const excludeIds = new Set(targetedSources.map((source) => source.id));
        const fallbackSources = fallbackOfficialSources(
          normalizedRequest,
          this.officialSources,
          excludeIds,
        );
        const fallbackConstraints = toDomainConstraints(fallbackSources);
        const noOfficialSourcesAvailable =
          targetedConstraints.length === 0 && fallbackConstraints.length === 0;

        if (noOfficialSourcesAvailable) {
          collected.push(EMPTY_PROVIDER_RESPONSE);
          shouldFallback = false;
        } else {
          if (targetedConstraints.length > 0) {
            collected.push(
              await this.searchProvider(
                normalizedRequest,
                normalizedRequest.language,
                context,
                deadline,
                targetedConstraints,
              ),
            );
          }
          const hasVerifiedOfficialResult = this.hasVerifiedOfficialResult(collected);
          const hasRemainingBudget = deadline - Date.now() > 0;
          if (!hasVerifiedOfficialResult && fallbackConstraints.length > 0 && hasRemainingBudget) {
            collected.push(
              await this.searchProvider(
                normalizedRequest,
                normalizedRequest.language,
                context,
                deadline,
                fallbackConstraints,
              ),
            );
          }

          const totalResultsSoFar = collected.reduce((sum, r) => sum + r.results.length, 0);
          shouldFallback =
            totalResultsSoFar === 0 && !normalizedRequest.language.toLowerCase().startsWith('en');
          if (shouldFallback) {
            const languageConstraints = [...targetedConstraints, ...fallbackConstraints];
            collected.push(
              await this.searchProvider(
                normalizedRequest,
                'en',
                context,
                deadline,
                languageConstraints,
              ),
            );
          }
        }
        responses = collected;
      } else {
        const first = await this.searchProvider(
          normalizedRequest,
          normalizedRequest.language,
          context,
          deadline,
          undefined,
        );
        shouldFallback =
          first.results.length === 0 && !normalizedRequest.language.toLowerCase().startsWith('en');
        responses = shouldFallback
          ? [
              first,
              await this.searchProvider(normalizedRequest, 'en', context, deadline, undefined),
            ]
          : [first];
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
    const providerResponse = mergeProviderResponses(responses);
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
    const unresponsiveEngines = providerResponse.unresponsiveEngines;
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

  private hasVerifiedOfficialResult(responses: readonly SearchProviderResponse[]): boolean {
    const seen = new Set<string>();
    for (const response of responses) {
      for (const result of response.results) {
        const normalized = normalizeResultUrl(result.url);
        if (normalized === undefined || seen.has(normalized)) continue;
        seen.add(normalized);
        if (this.officialSources.findByUrl(normalized) !== undefined) return true;
      }
    }
    return false;
  }

  private async searchProvider(
    request: NormalizedSearchRequest,
    language: string,
    context: OperationContext,
    deadline: number,
    domainConstraints?: readonly SearchDomainConstraint[],
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

function isAllowedOfficialSource(
  source: OfficialSource,
  request: NormalizedSearchRequest,
): boolean {
  if (!source.enabled) return false;
  const domain = source.domain.toLowerCase().replace(/\.$/u, '');
  if (matchesDomain(domain, request.excludedDomains)) return false;
  if (
    request.allowedDomains.length > 0 &&
    !matchesDomain(domain, request.allowedDomains) &&
    !request.allowedDomains.some((allowed) => matchesDomain(allowed, [domain]))
  ) {
    return false;
  }
  return true;
}

/** Sources whose keywords match the query — the precise, uncrowded first discovery pass. */
function targetedOfficialSources(
  request: NormalizedSearchRequest,
  registry: OfficialSourceRegistry,
): readonly OfficialSource[] {
  return registry
    .findForQuery(request.query)
    .filter((source) => isAllowedOfficialSource(source, request));
}

/** Remainder of the registry, used only as a fallback pass when the targeted pass is insufficient. */
function fallbackOfficialSources(
  request: NormalizedSearchRequest,
  registry: OfficialSourceRegistry,
  excludeIds: ReadonlySet<string>,
): readonly OfficialSource[] {
  return registry
    .list()
    .filter((source) => !excludeIds.has(source.id))
    .filter((source) => isAllowedOfficialSource(source, request));
}

function toDomainConstraints(
  sources: readonly OfficialSource[],
): readonly SearchDomainConstraint[] {
  const seen = new Set<string>();
  const constraints: SearchDomainConstraint[] = [];
  for (const source of sources) {
    const domain = source.domain.toLowerCase().replace(/\.$/u, '');
    const constraint: SearchDomainConstraint =
      source.pathPrefix === undefined ? { domain } : { domain, pathPrefix: source.pathPrefix };
    const key = `${domain}|${constraint.pathPrefix ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    constraints.push(constraint);
  }
  return constraints;
}

function mergeProviderResponses(
  responses: readonly SearchProviderResponse[],
): SearchProviderResponse {
  if (responses.length === 0) return EMPTY_PROVIDER_RESPONSE;
  const results = responses.flatMap((response) => response.results);
  const unresponsiveEngines = [
    ...new Set(responses.flatMap((response) => response.unresponsiveEngines)),
  ].sort(compareText);
  const totals = responses
    .map((response) => response.total)
    .filter((total): total is number => total !== undefined);
  const total = totals.length === 0 ? undefined : totals.reduce((sum, value) => sum + value, 0);
  return { results, ...(total === undefined ? {} : { total }), unresponsiveEngines };
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
