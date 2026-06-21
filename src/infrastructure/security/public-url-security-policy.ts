import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { UrlSecurityPolicy } from '../../application/ports/url-security-policy.js';
import type { ApprovedUrl } from '../../domain/models/public-url.js';
import { UrlSecurityError } from '../../domain/errors/domain-errors.js';

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

export interface PublicUrlSecurityOptions {
  readonly allowedPorts: readonly number[];
  readonly allowHttp: boolean;
}

export class PublicUrlSecurityPolicy implements UrlSecurityPolicy {
  public constructor(
    private readonly options: PublicUrlSecurityOptions,
    private readonly resolver: AddressResolver = resolveAll,
  ) {}

  public async assertAllowed(value: string): Promise<ApprovedUrl> {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new UrlSecurityError('The URL is invalid', 'INVALID_URL', { cause: error });
    }

    if (url.protocol !== 'https:' && !(this.options.allowHttp && url.protocol === 'http:')) {
      throw new UrlSecurityError('Only approved HTTP(S) URLs are allowed', 'UNSUPPORTED_PROTOCOL');
    }
    if (url.username !== '' || url.password !== '') {
      throw new UrlSecurityError('URLs containing credentials are not allowed', 'INVALID_URL');
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new UrlSecurityError('Local hostnames are not allowed');
    }

    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const port = url.port === '' ? defaultPort : Number.parseInt(url.port, 10);
    if (!this.options.allowedPorts.includes(port)) {
      throw new UrlSecurityError(`Port ${port} is not allowed`);
    }

    let addresses: readonly string[];
    if (isIP(hostname) !== 0) {
      addresses = [hostname];
    } else {
      try {
        addresses = await this.resolver(hostname);
      } catch (error) {
        throw new UrlSecurityError('The hostname cannot be resolved', 'DNS_RESOLUTION_FAILED', {
          cause: error,
        });
      }
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new UrlSecurityError('The URL resolves to a non-public network address');
    }

    url.hostname = hostname;
    url.hash = '';
    return { value: url.toString(), hostname, addresses };
  }
}

async function resolveAll(hostname: string): Promise<readonly string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return [...new Set(records.map((record) => record.address))];
}

export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPublicIpv4(address);
  if (kind === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  const blocked: readonly [number, number][] = [
    [ipv4ToNumber('0.0.0.0'), 8],
    [ipv4ToNumber('10.0.0.0'), 8],
    [ipv4ToNumber('100.64.0.0'), 10],
    [ipv4ToNumber('127.0.0.0'), 8],
    [ipv4ToNumber('169.254.0.0'), 16],
    [ipv4ToNumber('172.16.0.0'), 12],
    [ipv4ToNumber('192.0.0.0'), 24],
    [ipv4ToNumber('192.0.2.0'), 24],
    [ipv4ToNumber('192.168.0.0'), 16],
    [ipv4ToNumber('198.18.0.0'), 15],
    [ipv4ToNumber('198.51.100.0'), 24],
    [ipv4ToNumber('203.0.113.0'), 24],
    [ipv4ToNumber('224.0.0.0'), 4],
    [ipv4ToNumber('240.0.0.0'), 4],
  ];
  return !blocked.some(([network, bits]) => inIpv4Range(value, network, bits));
}

function ipv4ToNumber(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function inIpv4Range(value: number, network: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value === undefined) return false;

  const mappedPrefix = 0xffffn << 32n;
  if (value >> 32n === mappedPrefix >> 32n) {
    const ipv4 = Number(value & 0xffffffffn);
    return isPublicIpv4([24, 16, 8, 0].map((shift) => String((ipv4 >>> shift) & 0xff)).join('.'));
  }

  const blocked: readonly [bigint, number][] = [
    [0n, 128],
    [1n, 128],
    [0xfc00n << 112n, 7],
    [0xfe80n << 112n, 10],
    [0xff00n << 112n, 8],
    [0x20010db8n << 96n, 32],
  ];
  return !blocked.some(([network, bits]) => inIpv6Range(value, network, bits));
}

function ipv6ToBigInt(input: string): bigint | undefined {
  const address = input.split('%')[0] ?? input;
  const halves = address.split('::');
  if (halves.length > 2) return undefined;

  const parseHalf = (half: string): string[] => (half === '' ? [] : half.split(':'));
  const left = parseHalf(halves[0] ?? '');
  const right = parseHalf(halves[1] ?? '');
  const convertIpv4 = (parts: string[]): string[] => {
    const last = parts.at(-1);
    if (!last?.includes('.')) return parts;
    if (isIP(last) !== 4) return [];
    const numeric = ipv4ToNumber(last);
    return [
      ...parts.slice(0, -1),
      ((numeric >>> 16) & 0xffff).toString(16),
      (numeric & 0xffff).toString(16),
    ];
  };
  const convertedLeft = convertIpv4(left);
  const convertedRight = convertIpv4(right);
  const explicit = convertedLeft.length + convertedRight.length;
  const missing = halves.length === 2 ? 8 - explicit : 0;
  const groups = [
    ...convertedLeft,
    ...Array.from({ length: missing }, () => '0'),
    ...convertedRight,
  ];
  if (groups.length !== 8) return undefined;

  try {
    return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || '0'}`), 0n);
  } catch {
    return undefined;
  }
}

function inIpv6Range(value: bigint, network: bigint, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === network >> shift;
}
