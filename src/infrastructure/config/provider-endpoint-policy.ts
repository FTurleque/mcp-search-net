/**
 * Distinguishes local/internal provider endpoints (SearXNG, Crawl4AI) -- for which plain HTTP
 * is an intended, safe deployment shape (loopback, or a trusted Docker Compose service name on
 * an internal network) -- from remote endpoints, which must use HTTPS. This is deliberately the
 * inverse of the user-facing SSRF policy (`PublicUrlSecurityPolicy`), which instead blocks
 * private/loopback ranges for untrusted, caller-supplied URLs; conflating the two would either
 * reject every shipped provider configuration or defeat the SSRF guard's purpose.
 */

const TRUSTED_PROVIDER_SERVICE_HOSTNAMES = new Set(['searxng', 'crawl4ai']);

export function isLocalProviderEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return isLocalProviderHost(url.hostname);
}

export function isSafeProviderEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return true;
  return isLocalProviderHost(url.hostname);
}

function isLocalProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (TRUSTED_PROVIDER_SERVICE_HOSTNAMES.has(host)) return true;
  return isLoopbackOrPrivateAddress(host);
}

function isLoopbackOrPrivateAddress(host: string): boolean {
  const candidate = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (candidate === '::1') return true;
  const ipv4 = parseIpv4(candidate);
  if (ipv4 !== undefined) return isPrivateIpv4(ipv4);
  return isPrivateIpv6(candidate);
}

function parseIpv4(value: string): readonly [number, number, number, number] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  if (match === null) return undefined;
  const octets = match.slice(1, 5).map((segment) => Number.parseInt(segment, 10));
  if (octets.some((octet) => octet > 255)) return undefined;
  return octets as unknown as readonly [number, number, number, number];
}

function isPrivateIpv4([a, b]: readonly [number, number, number, number]): boolean {
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  if (/^fe[89ab][0-9a-f]:/u.test(normalized)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/u.test(normalized)) return true; // unique local fc00::/7
  return false;
}
