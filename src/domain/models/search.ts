export type SearchTimeRange = 'day' | 'week' | 'month' | 'year';
export type SourcePolicy = 'strict' | 'prefer' | 'any';
export type SourceStatus = 'VERIFIED_OFFICIAL' | 'LIKELY_OFFICIAL' | 'THIRD_PARTY' | 'UNKNOWN';

export interface SearchRequest {
  readonly query: string;
  readonly language?: string;
  readonly timeRange?: SearchTimeRange;
  readonly maxResults: number;
  readonly sourcePolicy?: SourcePolicy;
  readonly allowedDomains?: readonly string[];
  readonly excludedDomains?: readonly string[];
}

export interface NormalizedSearchRequest {
  readonly query: string;
  readonly language: string;
  readonly timeRange?: SearchTimeRange;
  readonly maxResults: number;
  readonly sourcePolicy: SourcePolicy;
  readonly allowedDomains: readonly string[];
  readonly excludedDomains: readonly string[];
}

export interface ProviderSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
  readonly engines: readonly string[];
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly detectedLanguage?: string;
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly snippet: string;
  readonly sourceStatus: SourceStatus;
  readonly engines: readonly string[];
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly detectedLanguage?: string;
  readonly score: number;
}

export interface SearchResponse {
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly metadata: {
    readonly total: number;
    readonly returned: number;
    readonly unresponsiveEngines: readonly string[];
  };
}
