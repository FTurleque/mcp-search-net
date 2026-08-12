import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        ),
    ),
  );
});

describe('SecureHttpGateway conditional validators', () => {
  it(
    'sends validators to the requested URI but never forwards them to a redirect target',
    async () => {
      let oldValidator: string | undefined;
      let newValidator: string | undefined;
      const server = createServer((request, response) => {
        if (request.url === '/old') {
          oldValidator = request.headers['if-none-match'];
          response.writeHead(302, { location: '/new' });
          response.end();
          return;
        }
        if (request.url === '/new') {
          newValidator = request.headers['if-none-match'];
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('redirected content');
          return;
        }
        response.writeHead(404);
        response.end();
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const policy: UrlSecurityPolicy = {
        async assertAllowed(value) {
          const url = new URL(value);
          return {
            value: url.toString(),
            hostname: url.hostname,
            addresses: ['127.0.0.1'],
          };
        },
      };
      const gateway = new SecureHttpGateway(policy, {
        timeoutMs: 2_000,
        maxBytes: 10_000,
        maxRedirects: 3,
        maxConcurrency: 1,
        minimumDelayMs: 0,
        respectRobotsTxt: false,
        userAgent: 'mcp-search-net-test/1.0',
      });

      const result = await gateway.download(`http://127.0.0.1:${port}/old`, {
        'if-none-match': '"v1"',
      });

      expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/new`);
      expect(new TextDecoder().decode(result.body)).toBe('redirected content');
      expect(oldValidator).toBe('"v1"');
      expect(newValidator).toBeUndefined();
    },
  );
});
