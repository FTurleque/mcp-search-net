import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () =>
  Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  ),
);

describe('SecureHttpGateway redirect robots policy', () => {
  it('re-checks robots rules before following a same-origin redirect target', async () => {
    const requests: string[] = [];
    const server = await listen((request, response) => {
      requests.push(request.url ?? '');
      if (request.url === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('User-agent: *\nDisallow: /private');
        return;
      }
      if (request.url === '/start') {
        response.writeHead(302, { location: '/private' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('must not be downloaded');
    });

    await expect(
      createGateway(policyFor(server.port)).download(`http://source.invalid:${server.port}/start`),
    ).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });

    expect(requests).toEqual(['/robots.txt', '/start']);
  });

  it('loads and enforces the redirected origin robots rules before connecting to its target path', async () => {
    const requests: string[] = [];
    const server = await listen((request, response) => {
      const host = request.headers.host?.split(':')[0] ?? '';
      requests.push(`${host}${request.url ?? ''}`);
      if (request.url === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(
          host === 'target.invalid'
            ? 'User-agent: *\nDisallow: /private'
            : 'User-agent: *\nAllow: /',
        );
        return;
      }
      if (host === 'source.invalid' && request.url === '/start') {
        response.writeHead(302, {
          location: `http://target.invalid:${server.port}/private`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('must not be downloaded');
    });

    await expect(
      createGateway(policyFor(server.port)).download(`http://source.invalid:${server.port}/start`),
    ).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });

    expect(requests).toEqual([
      'source.invalid/robots.txt',
      'source.invalid/start',
      'target.invalid/robots.txt',
    ]);
    expect(requests).not.toContain('target.invalid/private');
  });
});

async function listen(handler: RequestListener): Promise<{ url: string; port: number }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://source.invalid:${port}`, port };
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

function createGateway(policy: UrlSecurityPolicy): SecureHttpGateway {
  return new SecureHttpGateway(policy, {
    timeoutMs: 1_000,
    maxBytes: 10_000,
    maxRedirects: 5,
    maxConcurrency: 2,
    minimumDelayMs: 0,
    respectRobotsTxt: true,
    userAgent: 'mcp-search-net/1.0',
  });
}
