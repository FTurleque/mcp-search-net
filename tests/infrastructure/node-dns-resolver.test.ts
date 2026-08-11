import { describe, expect, it } from 'vitest';

import { NodeDnsResolver } from '../../src/infrastructure/security/node-dns-resolver.js';

describe('NodeDnsResolver', () => {
  it('deduplicates resolved addresses', async () => {
    const resolver = new NodeDnsResolver(2, async () => [
      { address: '203.0.113.10' },
      { address: '203.0.113.10' },
      { address: '203.0.113.11' },
    ]);

    await expect(resolver.resolve('example.test')).resolves.toEqual([
      '203.0.113.10',
      '203.0.113.11',
    ]);
  });

  it('bounds unresolved OS lookups instead of accumulating work after caller timeouts', async () => {
    const releases: Array<() => void> = [];
    const resolver = new NodeDnsResolver(
      2,
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve([{ address: '203.0.113.10' }]));
        }),
    );

    const first = resolver.resolve('first.example.test');
    const second = resolver.resolve('second.example.test');

    await expect(resolver.resolve('third.example.test')).rejects.toThrow('DNS_RESOLVER_SATURATED');

    releases.splice(0).forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toEqual([
      ['203.0.113.10'],
      ['203.0.113.10'],
    ]);

    await expect(resolver.resolve('after-release.example.test')).resolves.toEqual([
      '203.0.113.10',
    ]);
  });

  it('rejects invalid concurrency limits', () => {
    expect(() => new NodeDnsResolver(0)).toThrow(RangeError);
    expect(() => new NodeDnsResolver(Number.NaN)).toThrow(RangeError);
  });
});
