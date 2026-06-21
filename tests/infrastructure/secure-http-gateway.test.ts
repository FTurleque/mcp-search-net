import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { UrlSecurityError } from '../../src/domain/errors/domain-errors.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () =>
  Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  ),
);

describe('SecureHttpGateway', () => {
  it('validates a redirect target before opening the next connection', async () => {
    let requests = 0;
    const server = await listen((request, response) => {
      requests += 1;
      response.writeHead(302, { location: 'http://blocked.internal/secret' });
      response.end();
    });
    const policy = policyFor(server.port, async (url) => {
      if (new URL(url).hostname === 'blocked.internal') throw new UrlSecurityError('blocked');
    });
    const gateway = createGateway(policy);
    await expect(gateway.download(server.url)).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    expect(requests).toBe(1);
  });

  it('pins the approved address and stops after five redirects', async () => {
    const server = await listen((request, response) => {
      response.writeHead(302, { location: request.url === '/a' ? '/b' : '/a' });
      response.end();
    });
    await expect(
      createGateway(policyFor(server.port)).download(`${server.url}/a`),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
  });

  it('interrupts a response before it exceeds the byte budget', async () => {
    const server = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(2_000));
    });
    const gateway = createGateway(policyFor(server.port), { maxBytes: 1_024 });
    await expect(gateway.download(server.url)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it('applies an absolute timeout', async () => {
    const server = await listen((_request, response) =>
      setTimeout(() => response.end('late'), 100),
    );
    const gateway = createGateway(policyFor(server.port), { timeoutMs: 20 });
    await expect(gateway.download(server.url)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('enforces robots.txt before downloading a disallowed page', async () => {
    const paths: string[] = [];
    const server = await listen((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? 'User-agent: *\nDisallow: /private' : 'secret');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });
    await expect(gateway.download(`${server.url}/private`)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(paths).toEqual(['/robots.txt']);
  });
});

async function listen(handler: RequestListener): Promise<{ url: string; port: number }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://test.invalid:${port}`, port };
}

function policyFor(
  port: number,
  beforeApprove?: (url: string) => Promise<void>,
): UrlSecurityPolicy {
  return {
    async assertAllowed(value) {
      await beforeApprove?.(value);
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
    userAgent: 'mcp-search-net/1.0',
    ...overrides,
  });
}
