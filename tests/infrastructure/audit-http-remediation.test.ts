import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () =>
  Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  ),
);

describe('audit HTTP remediation', () => {
  it('enforces the wall-clock deadline against a slow-drip response', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const interval = setInterval(() => response.write('x'), 5);
      response.on('close', () => clearInterval(interval));
    });
    const target = await listen(server);
    const gateway = createGateway(policyFor(target.port), { timeoutMs: 35, maxBytes: 1_000_000 });

    const started = performance.now();
    await expect(gateway.download(target.url)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('does not spend the byte budget on a redirect body', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, {
          location: '/final',
          'content-type': 'text/plain',
          'content-length': '5000',
        });
        response.end('x'.repeat(5_000));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
    const target = await listen(server);
    const gateway = createGateway(policyFor(target.port), { maxBytes: 16 });

    const result = await gateway.download(`${target.url}/redirect`);

    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe('ok');
    expect(result.redirectChain).toHaveLength(1);
  });

  it('still enforces the final response byte budget', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(100));
    });
    const target = await listen(server);
    const gateway = createGateway(policyFor(target.port), { maxBytes: 16 });

    await expect(gateway.download(target.url)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });
});

async function listen(server: ReturnType<typeof createServer>): Promise<{ url: string; port: number }> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://audit.invalid:${port}`, port };
}

function policyFor(port: number): UrlSecurityPolicy {
  return {
    async assertAllowed(value) {
      const url = new URL(value);
      url.port = String(port);
      return { value: url.toString(), hostname: url.hostname, addresses: ['127.0.0.1'] };
    },
  };
}

function createGateway(
  policy: UrlSecurityPolicy,
  overrides: Partial<ConstructorParameters<typeof SecureHttpGateway>[1]> = {},
): SecureHttpGateway {
  return new SecureHttpGateway(policy, {
    timeoutMs: 1_000,
    maxBytes: 10_000,
    maxRedirects: 5,
    maxConcurrency: 2,
    minimumDelayMs: 0,
    respectRobotsTxt: false,
    userAgent: 'mcp-search-net/1.1.0',
    ...overrides,
  });
}
