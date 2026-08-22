import type { ProviderSearchResult, SearchTimeRange } from '../../domain/models/search.js';
import type { SearchQuery } from '../../domain/value-objects/search-query.js';

export interface SearchDomainConstraint {
  readonly domain: string;
  /** Optional path scope (e.g. a GitHub organization/repository prefix) narrowing the domain. */
  readonly pathPrefix?: string;
}

export interface SearchProviderRequest {
  readonly query: SearchQuery;
  readonly language?: string;
  readonly timeRange?: SearchTimeRange;
  readonly maxResults: number;
  /** Optional verified domains (optionally path-scoped) used to constrain provider discovery at query time. */
  readonly domainConstraints?: readonly SearchDomainConstraint[];
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
