import { isIP } from 'node:net';

import type { DnsResolver } from '../../application/ports/dns-resolver.js';
import type { UrlSecurityPolicy } from '../../application/ports/url-security-policy.js';
import type { ApprovedUrl } from '../../domain/models/public-url.js';
import {
  BlockedAddressError,
  DnsResolutionError,
  UnsupportedProtocolError,
  UrlSecurityError,
} from '../../domain/errors/domain-errors.js';
import type { Telemetry } from '../../application/ports/telemetry.js';
import { NodeDnsResolver } from './node-dns-resolver.js';

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

export interface PublicUrlSecurityOptions {
  readonly allowedPorts: readonly number[];
  readonly allowHttp: boolean;
}

export class PublicUrlSecurityPolicy implements UrlSecurityPolicy {
  public constructor(
    private readonly options: PublicUrlSecurityOptions,
    private readonly resolver: DnsResolver | AddressResolver = new NodeDnsResolver(),
    private readonly telemetry?: Telemetry,
  ) {}

  public async assertAllowed(
    value: string,
    context: { readonly requestId?: string; readonly tool?: 'search_web' | 'fetch_url' } = {},
  ): Promise<ApprovedUrl> {
    try {
      return await this.validate(value);
    } catch (error) {
      this.telemetry?.record('url_blocked', {
        requestId: context.requestId,
        tool: context.tool ?? 'fetch_url',
        domain: safeHostname(value),
        code: error instanceof UrlSecurityError ? error.code : 'INVALID_URL',
      });
      throw error;
    }
  }

  private async validate(value: string): Promise<ApprovedUrl> {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new UrlSecurityError('The URL is invalid', 'INVALID_URL', { cause: error });
    }

    if (url.protocol !== 'https:' && !(this.options.allowHttp && url.protocol === 'http:')) {
      throw new UnsupportedProtocolError('Only approved HTTP(S) URLs are allowed');
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
      throw new BlockedAddressError('Local hostnames are not allowed');
    }

    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const port = url.port === '' ? defaultPort : Number.parseInt(url.port, 10);
    if (!this.options.allowedPorts.includes(port)) {
      throw new BlockedAddressError(`Port ${port} is not allowed`);
    }

    let addresses: readonly string[];
    if (isIP(hostname) !== 0) {
      addresses = [hostname];
    } else {
      try {
        addresses =
          typeof this.resolver === 'function'
            ? await this.resolver(hostname)
            : await this.resolver.resolve(hostname);
      } catch (error) {
        throw new DnsResolutionError('The hostname cannot be resolved', {
          cause: error,
        });
      }
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new BlockedAddressError('The URL resolves to a non-public network address');
    }

    url.hostname = hostname;
    url.hash = '';
    return { value: url.toString(), hostname, addresses };
  }
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
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

  const blockedCidrs: readonly [string, number][] = [
    ['::', 96],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
    ['5f00::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ];
  return !blockedCidrs.some(([network, bits]) => {
    const networkValue = ipv6ToBigInt(network);
    return networkValue === undefined || inIpv6Range(value, networkValue, bits);
  });
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
    return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group || '0'}`), 0n);
  } catch {
    return undefined;
  }
}

function inIpv6Range(value: bigint, network: bigint, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === network >> shift;
}
