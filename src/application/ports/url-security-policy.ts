import type { ApprovedUrl } from '../../domain/models/public-url.js';

export interface UrlSecurityPolicy {
  assertAllowed(url: string): Promise<ApprovedUrl>;
}
