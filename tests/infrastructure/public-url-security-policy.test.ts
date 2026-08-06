import { describe, expect, it } from 'vitest';

import {
  PublicUrlSecurityPolicy,
  isPublicAddress,
} from '../../src/infrastructure/security/public-url-security-policy.js';

describe('PublicUrlSecurityPolicy', () => {
  const options = { allowedPorts: [80, 443], allowHttp: true } as const;

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '::1',
    '::127.0.0.1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::1',
    '100::1',
    '2001::1',
    '2001:2::1',
    '2001:20::1',
    '2001:db8::1',
    '2002:7f00:1::1',
    '3fff::1',
    '5f00::1',
  ])('rejects non-public or special-purpose address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'accepts public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it('rejects hostnames resolving to a private address', async () => {
    const policy = new PublicUrlSecurityPolicy(options, async () => ['192.168.1.10']);
    await expect(policy.assertAllowed('https://example.com/path')).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
  });

  it('rejects mixed public and private DNS answers', async () => {
    const policy = new PublicUrlSecurityPolicy(options, async () => ['93.184.216.34', '10.0.0.7']);
    await expect(policy.assertAllowed('https://example.com/path')).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
  });

  it('canonicalizes an approved URL', async () => {
    const policy = new PublicUrlSecurityPolicy(options, async () => ['93.184.216.34']);
    await expect(policy.assertAllowed('https://Example.COM/docs#section')).resolves.toEqual({
      value: 'https://example.com/docs',
      hostname: 'example.com',
      addresses: ['93.184.216.34'],
    });
  });

  it('rejects credentials and unexpected ports', async () => {
    const policy = new PublicUrlSecurityPolicy(options, async () => ['93.184.216.34']);
    await expect(policy.assertAllowed('https://user:pass@example.com')).rejects.toBeDefined();
    await expect(policy.assertAllowed('https://example.com:8443')).rejects.toBeDefined();
  });

  it('accepts a non-default public port only when configured', async () => {
    const resolver = async () => ['93.184.216.34'];
    const defaultPolicy = new PublicUrlSecurityPolicy(options, resolver);
    const configuredPolicy = new PublicUrlSecurityPolicy(
      { allowedPorts: [80, 443, 8443], allowHttp: true },
      resolver,
    );
    await expect(
      defaultPolicy.assertAllowed('https://example.com:8443/docs'),
    ).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    await expect(
      configuredPolicy.assertAllowed('https://example.com:8443/docs'),
    ).resolves.toMatchObject({
      value: 'https://example.com:8443/docs',
    });
  });

  it('maps invalid URLs, protocols and DNS failures to stable codes', async () => {
    const policy = new PublicUrlSecurityPolicy(options, async () => {
      throw new Error('dns unavailable');
    });
    await expect(policy.assertAllowed('not a url')).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(policy.assertAllowed('file:///etc/passwd')).rejects.toMatchObject({
      code: 'UNSUPPORTED_PROTOCOL',
    });
    await expect(policy.assertAllowed('https://example.com')).rejects.toMatchObject({
      code: 'DNS_RESOLUTION_FAILED',
    });
  });

  it('emits a correlated url_blocked event without the full URL', async () => {
    const events: { event: string; data?: Readonly<Record<string, unknown>> }[] = [];
    const policy = new PublicUrlSecurityPolicy(options, async () => ['127.0.0.1'], {
      record: (event, data) => events.push({ event, ...(data === undefined ? {} : { data }) }),
    });
    await expect(
      policy.assertAllowed('https://example.com/private?token=secret', {
        requestId: 'request-1',
        tool: 'fetch_url',
      }),
    ).rejects.toBeDefined();
    expect(events).toEqual([
      {
        event: 'url_blocked',
        data: {
          requestId: 'request-1',
          tool: 'fetch_url',
          domain: 'example.com',
          code: 'BLOCKED_ADDRESS',
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('token=secret');
  });
});
