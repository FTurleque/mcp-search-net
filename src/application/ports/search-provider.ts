import type { ProviderSearchResult, SearchTimeRange } from '../../domain/models/search.js';
import type { SearchQuery } from '../../domain/value-objects/search-query.js';

export interface SearchProviderRequest {
  readonly query: SearchQuery;
  readonly language?: string;
  readonly timeRange?: SearchTimeRange;
  readonly maxResults: number;
  /** Optional verified domains used to constrain provider discovery at query time. */
  readonly domainConstraints?: readonly string[];
  /** Absolute Unix epoch deadline shared by the whole search_web operation. */
  readonly deadlineMs?: number;
}

export interface SearchProviderResponse {
  readonly results: readonly ProviderSearchResult[];
  readonly total?: number;
  readonly unresponsiveEngines: readonly string[];
}

export interface SearchProvider {
  search(request: SearchProviderRequest): Promise<SearchProviderResponse>;
}
