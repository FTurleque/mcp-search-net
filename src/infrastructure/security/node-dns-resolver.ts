import { lookup } from 'node:dns/promises';

import type { DnsResolver } from '../../application/ports/dns-resolver.js';

const DEFAULT_MAX_CONCURRENT_LOOKUPS = 16;

type LookupResult = readonly { readonly address: string }[];
type AddressLookup = (
  hostname: string,
  options: { readonly all: true; readonly verbatim: true },
) => Promise<LookupResult>;

export class NodeDnsResolver implements DnsResolver {
  private activeLookups = 0;

  public constructor(
    private readonly maxConcurrentLookups = DEFAULT_MAX_CONCURRENT_LOOKUPS,
    private readonly lookupImplementation: AddressLookup = lookup,
  ) {
    if (!Number.isSafeInteger(maxConcurrentLookups) || maxConcurrentLookups <= 0) {
      throw new RangeError('maxConcurrentLookups must be a positive safe integer');
    }
  }

  public async resolve(hostname: string): Promise<readonly string[]> {
    if (this.activeLookups >= this.maxConcurrentLookups) {
      throw new Error('DNS_RESOLVER_SATURATED');
    }

    this.activeLookups += 1;
    try {
      const records = await this.lookupImplementation(hostname, { all: true, verbatim: true });
      return [...new Set(records.map((record) => record.address))];
    } finally {
      this.activeLookups -= 1;
    }
  }
}
