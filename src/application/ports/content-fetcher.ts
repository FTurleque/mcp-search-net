import type { FetchedContent, RenderMode } from '../../domain/models/content.js';

export interface ContentFetcher {
  fetch(url: string, renderMode: RenderMode): Promise<FetchedContent>;
}
