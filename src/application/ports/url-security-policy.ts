import type { ApprovedUrl } from '../../domain/models/public-url.js';

export interface UrlSecurityPolicy {
  assertAllowed(
    url: string,
    context?: { readonly requestId?: string; readonly tool?: 'search_web' | 'fetch_url' },
  ): Promise<ApprovedUrl>;
}
