import { InvalidWebUrlError, UnsupportedProtocolError } from '../errors/domain-errors.js';
import { DomainName } from './domain-name.js';

const TRACKING_PARAMETERS = new Set([
  'dclid',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  '_hsenc',
  '_hsmi',
]);

export class WebUrl {
  private constructor(
    public readonly value: string,
    public readonly domain: DomainName,
  ) {}

  /**
   * Canonical identity used for search-result deduplication and cache keys.
   * This intentionally removes tracking parameters and normalizes query order.
   */
  public static create(input: string): WebUrl {
    const { url, domain } = parseWebUrl(input);
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith('utm_') || TRACKING_PARAMETERS.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
    return new WebUrl(url.toString(), domain);
  }

  /**
   * Transport URL used for the actual HTTP request. It performs the same safety-oriented
   * syntactic validation as the canonical form, but preserves query parameters and their order.
   */
  public static createTransport(input: string): WebUrl {
    const { url, domain } = parseWebUrl(input);
    return new WebUrl(url.toString(), domain);
  }

  public static tryCreate(input: string): WebUrl | undefined {
    try {
      return WebUrl.create(input);
    } catch {
      return undefined;
    }
  }
}

function parseWebUrl(input: string): { readonly url: URL; readonly domain: DomainName } {
  if (input.length > 4_096) throw new InvalidWebUrlError('The URL exceeds 4096 characters');
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new InvalidWebUrlError('The URL must be absolute', { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsupportedProtocolError();
  }
  if (url.username !== '' || url.password !== '') {
    throw new InvalidWebUrlError('URLs containing credentials are not allowed');
  }
  const domain = DomainName.create(url.hostname);
  url.hostname = domain.value;
  url.hash = '';
  return { url, domain };
}
