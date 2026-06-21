import type { CacheValidators } from './cache-repository.js';
import type { ContentFetchResult, RenderMode } from '../../domain/models/content.js';

export interface ContentFetchContext extends CacheValidators {
  readonly requestId?: string;
}

export interface ContentFetcher {
  fetch(
    url: string,
    renderMode: RenderMode,
    context?: ContentFetchContext,
  ): Promise<ContentFetchResult>;
}
