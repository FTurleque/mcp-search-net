import { lookup } from 'node:dns/promises';

import type { DnsResolver } from '../../application/ports/dns-resolver.js';

export class NodeDnsResolver implements DnsResolver {
  public async resolve(hostname: string): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return [...new Set(records.map((record) => record.address))];
  }
}
