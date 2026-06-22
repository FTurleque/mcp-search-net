import { InvalidWebUrlError } from '../errors/domain-errors.js';
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

  public static create(input: string): WebUrl {
    let url: URL;
    try {
      url = new URL(input);
    } catch (error) {
      throw new InvalidWebUrlError('The URL must be absolute', { cause: error });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new InvalidWebUrlError('Only HTTP and HTTPS URLs are supported');
    }
    if (url.username !== '' || url.password !== '') {
      throw new InvalidWebUrlError('URLs containing credentials are not allowed');
    }
    const domain = DomainName.create(url.hostname);
    url.hostname = domain.value;
    url.hash = '';
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

  public static tryCreate(input: string): WebUrl | undefined {
    try {
      return WebUrl.create(input);
    } catch {
      return undefined;
    }
  }
}
