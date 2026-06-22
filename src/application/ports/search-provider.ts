import type { ProviderSearchResult, SearchTimeRange } from '../../domain/models/search.js';
import type { SearchQuery } from '../../domain/value-objects/search-query.js';

export interface SearchProviderRequest {
  readonly query: SearchQuery;
  readonly language?: string;
  readonly timeRange?: SearchTimeRange;
  readonly maxResults: number;
}

export interface SearchProviderResponse {
  readonly results: readonly ProviderSearchResult[];
  readonly total?: number;
  readonly unresponsiveEngines: readonly string[];
}

export interface SearchProvider {
  search(request: SearchProviderRequest): Promise<SearchProviderResponse>;
}
