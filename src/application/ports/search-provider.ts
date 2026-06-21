import type { ProviderSearchResult, SearchTimeRange } from '../../domain/models/search.js';

export interface SearchProviderRequest {
  readonly query: string;
  readonly language?: string;
  readonly timeRange?: SearchTimeRange;
  readonly limit: number;
}

export interface SearchProviderResponse {
  readonly results: readonly ProviderSearchResult[];
  readonly total?: number;
  readonly unresponsiveEngines: readonly string[];
}

export interface SearchProvider {
  search(request: SearchProviderRequest): Promise<SearchProviderResponse>;
}
