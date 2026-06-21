import { createHash } from 'node:crypto';

import type { CacheRepository } from '../ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type { SearchProvider } from '../ports/search-provider.js';
import type { SearchRequest, SearchResponse } from '../../domain/models/search.js';
import { rankAndDeduplicate, toSearchResult } from '../../domain/services/result-ranking.js';

export interface SearchWebOptions {
  readonly cacheTtlMs: number;
  readonly providerOversampling: number;
  readonly maxSnippetChars: number;
}

export class SearchWeb {
  public constructor(
    private readonly provider: SearchProvider,
    private readonly cache: CacheRepository,
    private readonly officialSources: OfficialSourceRegistry,
    private readonly options: SearchWebOptions,
  ) {}

  public async execute(request: SearchRequest): Promise<SearchResponse> {
    const key = cacheKey({ ...request, sources: this.officialSources.version() });
    const cached = await this.cache.get<
      Omit<SearchResponse, 'metadata'> & {
        metadata: Omit<SearchResponse['metadata'], 'cached'>;
      }
    >('search', key);

    if (cached !== undefined) {
      return {
        ...cached.value,
        metadata: { ...cached.value.metadata, cached: true },
      };
    }

    const providerResponse = await this.provider.search({
      query: request.query,
      ...(request.language === undefined ? {} : { language: request.language }),
      ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
      limit: request.maxResults * this.options.providerOversampling,
    });

    const normalized = providerResponse.results
      .map((result) => {
        const official = this.officialSources.findByUrl(result.url);
        const mapped = toSearchResult(result, official);
        if (mapped === undefined) return undefined;
        return {
          ...mapped,
          snippet: truncate(mapped.snippet, this.options.maxSnippetChars),
        };
      })
      .filter((result) => result !== undefined)
      .filter((result) => !request.officialOnly || result.official);

    const results = rankAndDeduplicate(normalized, request.maxResults);
    const value = {
      query: request.query,
      results,
      metadata: {
        total: providerResponse.total ?? normalized.length,
        returned: results.length,
        unresponsiveEngines: providerResponse.unresponsiveEngines,
      },
    };

    await this.cache.set('search', key, value, this.options.cacheTtlMs);
    return { ...value, metadata: { ...value.metadata, cached: false } };
  }
}

function cacheKey(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
