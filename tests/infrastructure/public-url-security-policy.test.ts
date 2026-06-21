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
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
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
});
