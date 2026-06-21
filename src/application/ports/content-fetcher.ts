import type { FetchedContent } from '../../domain/models/content.js';

export interface ContentFetcher {
  fetch(url: string): Promise<FetchedContent>;
}
