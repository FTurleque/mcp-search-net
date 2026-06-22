import type { CacheValidators } from './cache-repository.js';
import type { ContentFetchResult, RenderMode } from '../../domain/models/content.js';

export interface ContentFetchContext extends CacheValidators {
  readonly requestId?: string;
  readonly timeoutMs?: number;
  readonly maxDownloadBytes?: number;
  readonly maxRedirects?: number;
}

export interface ContentFetcher {
  fetch(
    url: string,
    renderMode: RenderMode,
    context?: ContentFetchContext,
  ): Promise<ContentFetchResult>;
}
