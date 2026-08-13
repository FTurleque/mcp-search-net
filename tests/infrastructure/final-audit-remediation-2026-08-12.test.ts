import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { assertDistinctDatabasePaths } from '../../src/infrastructure/config/load-configuration.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

const roots: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('final audit infrastructure remediation', () => {
  it('rejects two absent database files that resolve through aliased parent directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-db-alias-'));
    roots.push(root);
    const realDirectory = join(root, 'real');
    const aliasDirectory = join(root, 'alias');
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() =>
      assertDistinctDatabasePaths(
        join(aliasDirectory, 'shared.db'),
        join(realDirectory, 'shared.db'),
      ),
    ).toThrow('Cache and catalog paths must be different');
  });

  it('enforces robots rules of a redirect target origin before downloading it', async () => {
    let privateRequests = 0;
    const server = await listen((request, response) => {
      const hostname = (request.headers.host ?? '').split(':')[0];
      if (request.url === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(
          hostname === 'target.invalid'
            ? 'User-agent: *\nDisallow: /private'
            : 'User-agent: *\nAllow: /',
        );
        return;
      }
      if (request.url === '/start') {
        response.writeHead(302, { location: `http://target.invalid:${server.port}/private` });
        response.end();
        return;
      }
      if (request.url === '/private') privateRequests += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('secret');
    });

    const gateway = createGateway(policyFor(server.port));
    await expect(
      gateway.download(`http://redirector.invalid:${server.port}/start`),
    ).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    expect(privateRequests).toBe(0);
  });

  it('re-evaluates cached robots rules for a same-origin redirect path', async () => {
    let privateRequests = 0;
    const server = await listen((request, response) => {
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
      if (request.url === '/private') privateRequests += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('secret');
    });

    const gateway = createGateway(policyFor(server.port));
    await expect(
      gateway.download(`http://same.invalid:${server.port}/start`),
    ).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(privateRequests).toBe(0);
  });
});

async function listen(handler: RequestListener): Promise<{ url: string; port: number }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://test.invalid:${port}`, port };
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
    userAgent: 'mcp-search-net/1.1.2',
  });
}
