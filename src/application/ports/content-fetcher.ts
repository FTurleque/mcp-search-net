import type { CacheValidators } from './cache-repository.js';
import type { ContentFetchResult, RenderMode } from '../../domain/models/content.js';
import type { WebUrl } from '../../domain/value-objects/web-url.js';

export interface ContentFetchRequest {
  readonly url: WebUrl;
  readonly renderMode: RenderMode;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly requestId?: string;
  readonly cacheValidators?: CacheValidators;
}

export interface ContentFetcher {
  fetch(request: ContentFetchRequest): Promise<ContentFetchResult>;
}
