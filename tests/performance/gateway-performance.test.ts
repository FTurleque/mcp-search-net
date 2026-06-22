import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

describe('download limits and concurrency performance', () => {
  const payload = Buffer.alloc(10 * 1024 * 1024 - 1_024, 0x61);
  let port = 0;
  let active = 0;
  let peak = 0;
  const server = createServer((request, response) => {
    if (request.url === '/large') {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': payload.length });
      response.end(payload);
      return;
    }
    active += 1;
    peak = Math.max(peak, active);
    setTimeout(() => {
      active -= 1;
      response.end('documentation response');
    }, 30);
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  const policy: UrlSecurityPolicy = {
    async assertAllowed(value) {
      const url = new URL(value);
      url.port = String(port);
      return { value: url.toString(), hostname: url.hostname, addresses: ['127.0.0.1'] };
    },
  };

  it('accepts a response just below 10 MiB without truncating the transfer', async () => {
    const gateway = gatewayWith(2);
    const response = await gateway.download(`http://performance.invalid:${port}/large`);
    expect(response.body.byteLength).toBe(payload.length);
  });

  it('never exceeds configured target concurrency', async () => {
    peak = 0;
    const gateway = gatewayWith(2);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        gateway.download(`http://performance.invalid:${port}/request-${index}`),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  function gatewayWith(maxConcurrency: number): SecureHttpGateway {
    return new SecureHttpGateway(policy, {
      timeoutMs: 10_000,
      maxBytes: 10 * 1024 * 1024,
      maxRedirects: 5,
      maxConcurrency,
      minimumDelayMs: 0,
      respectRobotsTxt: false,
      userAgent: 'mcp-search-net-performance/1.0',
    });
  }
});
