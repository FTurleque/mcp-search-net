import { describe, expect, it } from 'vitest';

import { PublicUrlSecurityPolicy } from '../../src/infrastructure/security/public-url-security-policy.js';

describe('forbidden protocol matrix', () => {
  const policy = new PublicUrlSecurityPolicy(
    { allowedPorts: [80, 443], allowHttp: true },
    async () => ['93.184.216.34'],
  );

  it.each(['file:', 'ftp:', 'data:', 'javascript:', 'gopher:', 'smb:', 'ssh:', 'ws:', 'wss:'])(
    'rejects %s before DNS',
    async (protocol) => {
      const value =
        protocol === 'data:' ? 'data:text/plain,secret' : `${protocol}//example.com/resource`;
      await expect(policy.assertAllowed(value)).rejects.toMatchObject({
        code: 'UNSUPPORTED_PROTOCOL',
      });
    },
  );
});
