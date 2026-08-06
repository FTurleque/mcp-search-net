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

  it('tries the next approved DNS address after a connection failure', async () => {
    const server = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('reachable');
    });
    const gateway = createGateway(policyForAddresses(server.port, ['127.0.0.2', '127.0.0.1']));

    await expect(gateway.download(server.url)).resolves.toMatchObject({ status: 200 });
  });

  it('records permanent and temporary redirects in the returned resource', async () => {
    const server = await listen((request, response) => {
      if (request.url === '/old') {
        response.writeHead(301, { location: '/temporary' });
        response.end();
        return;
      }
      if (request.url === '/temporary') {
        response.writeHead(302, { location: '/final' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('final content');
    });

    const resource = await createGateway(policyFor(server.port)).download(`${server.url}/old`);

    expect(resource.finalUrl).toBe(`${server.url}/final`);
    expect(resource.redirectChain).toEqual([
      {
        fromUrl: `${server.url}/old`,
        toUrl: `${server.url}/temporary`,
        status: 301,
        permanent: true,
      },
      {
        fromUrl: `${server.url}/temporary`,
        toUrl: `${server.url}/final`,
        status: 302,
        permanent: false,
      },
    ]);
  });

  it('returns a conditional 304 response without treating it as a redirect', async () => {
    let conditionalHeader: string | undefined;
    const server = await listen((request, response) => {
      conditionalHeader = request.headers['if-none-match'];
      response.writeHead(304, { etag: '"v1"' });
      response.end();
    });

    const resource = await createGateway(policyFor(server.port)).download(server.url, {
      'if-none-match': '"v1"',
    });

    expect(conditionalHeader).toBe('"v1"');
    expect(resource).toMatchObject({
      requestedUrl: server.url,
      finalUrl: `${server.url}/`,
      status: 304,
      redirectChain: [],
    });
    expect(resource.body).toHaveLength(0);
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

  it('serializes queued downloads when maxConcurrency is one', async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let requests = 0;
    const server = await listen((_request, response) => {
      requests += 1;
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      setTimeout(() => {
        activeRequests -= 1;
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ok');
      }, 30);
    });
    const gateway = createGateway(policyFor(server.port), {
      maxConcurrency: 1,
      timeoutMs: 1_000,
    });

    const [first, second] = await Promise.all([
      gateway.download(`${server.url}/first`),
      gateway.download(`${server.url}/second`),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(requests).toBe(2);
    expect(maximumActiveRequests).toBe(1);
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

  it('does not merge rules from an adjacent user-agent group', async () => {
    const paths: string[] = [];
    const robots = [
      'User-agent: *',
      'Disallow: /private',
      'User-agent: googlebot',
      'Allow: /private',
    ].join('\n');
    const server = await listen((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'secret');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });

    await expect(gateway.download(`${server.url}/private`)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(paths).toEqual(['/robots.txt']);
  });

  it('uses a matching specific user-agent group instead of wildcard rules', async () => {
    const robots = [
      'User-agent: *',
      'Disallow: /private',
      '',
      'User-agent: mcp-search-net',
      'Allow: /private',
    ].join('\n');
    const server = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'allowed');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });

    await expect(gateway.download(`${server.url}/private`)).resolves.toMatchObject({ status: 200 });
  });

  it('keeps blank lines inside the current robots group', async () => {
    const robots = ['User-agent: *', 'Disallow: /private', '', 'Allow: /private/public'].join('\n');
    const server = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'allowed');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });

    await expect(gateway.download(`${server.url}/private/public`)).resolves.toMatchObject({
      status: 200,
    });
  });

  it('matches robots rules against the query component', async () => {
    const robots = 'User-agent: *\nDisallow: /search?secret=';
    const paths: string[] = [];
    const server = await listen((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'secret');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });

    await expect(gateway.download(`${server.url}/search?secret=value`)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(paths).toEqual(['/robots.txt']);
  });

  it('normalizes unreserved percent encodings and UTF-8 robots octets', async () => {
    const robots = ['User-agent: *', 'Disallow: /foo/bar', 'Disallow: /café'].join('\n');
    const paths: string[] = [];
    const server = await listen((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'secret');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });

    await expect(gateway.download(`${server.url}/foo/%62ar`)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    await expect(gateway.download(`${server.url}/caf%C3%A9`)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(paths).toEqual(['/robots.txt', '/robots.txt']);
  });

  it('supports robots wildcards, end anchors and allow precedence on equal specificity', async () => {
    const paths: string[] = [];
    const robots = [
      'User-agent: *',
      'Disallow: /private/*/download$',
      'Disallow: /same',
      'Allow: /same',
    ].join('\n');
    const server = await listen((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'ok');
    });
    const gateway = createGateway(policyFor(server.port), { respectRobotsTxt: true });

    await expect(gateway.download(`${server.url}/private/a/download`)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    await expect(gateway.download(`${server.url}/private/a/download/extra`)).resolves.toMatchObject(
      {
        status: 200,
      },
    );
    await expect(gateway.download(`${server.url}/same`)).resolves.toMatchObject({ status: 200 });
    expect(paths.filter((path) => path === '/robots.txt')).toHaveLength(3);
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

function policyForAddresses(port: number, addresses: readonly string[]): UrlSecurityPolicy {
  return {
    async assertAllowed(value) {
      const url = new URL(value);
      url.port = String(port);
      return { value: url.toString(), hostname: url.hostname, addresses };
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
