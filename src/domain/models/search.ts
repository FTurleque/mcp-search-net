export type SearchTimeRange = 'day' | 'month' | 'year';

export interface SearchRequest {
  readonly query: string;
  readonly language?: string;
  readonly timeRange?: SearchTimeRange;
  readonly maxResults: number;
  readonly officialOnly: boolean;
}

export interface ProviderSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
  readonly engines: readonly string[];
  readonly publishedAt?: string;
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source: string;
  readonly official: boolean;
  readonly engines: readonly string[];
  readonly publishedAt?: string;
  readonly score: number;
}

export interface SearchResponse {
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly metadata: {
    readonly cached: boolean;
    readonly total: number;
    readonly returned: number;
    readonly unresponsiveEngines: readonly string[];
  };
}
