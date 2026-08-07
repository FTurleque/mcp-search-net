import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';
import { sanitizePreparedHtml } from '../../src/infrastructure/fetch/prepared-html-sanitizer.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { PublicUrlSecurityPolicy } from '../../src/infrastructure/security/public-url-security-policy.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () =>
  Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  ),
);

describe('post-audit network hardening', () => {
  it('applies origin robots.txt rules to a nested path named robots.txt', async () => {
    const paths: string[] = [];
    const server = await listen((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(
        request.url === '/robots.txt'
          ? 'User-agent: *\nDisallow: /private/robots.txt'
          : 'should never be downloaded',
      );
    });

    await expect(
      createGateway(policyFor(server.port), { respectRobotsTxt: true }).download(
        `${server.url}/private/robots.txt`,
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    expect(paths).toEqual(['/robots.txt']);
  });

  it('shares one byte budget between robots.txt and the target resource', async () => {
    const robots = `User-agent: *\nAllow: /\n${'x'.repeat(40)}`;
    const server = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.url === '/robots.txt' ? robots : 'y'.repeat(60));
    });

    await expect(
      createGateway(policyFor(server.port), {
        respectRobotsTxt: true,
        maxBytes: 100,
      }).download(`${server.url}/document`),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
});

describe('prepared HTML hardening', () => {
  it('drops an unterminated active block instead of handing it to the renderer', () => {
    const sanitized = sanitizePreparedHtml(
      '<html><body><p>safe text</p><script>fetch("http://127.0.0.1/private")',
    );

    expect(sanitized).toContain('safe text');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('127.0.0.1');
  });

  it('drops malformed unterminated start tags and strips resource/event attributes', () => {
    const wellFormed = sanitizePreparedHtml(
      '<div onclick="run()" style="background:url(http://127.0.0.1/a)">safe</div>' +
        '<img src="http://127.0.0.1/b">',
    );
    const malformed = sanitizePreparedHtml(
      '<p>before</p><div data-safe="ok" src="http://127.0.0.1/c"',
    );

    expect(wellFormed).toContain('<div>safe</div>');
    expect(wellFormed).not.toContain('onclick');
    expect(wellFormed).not.toContain('style=');
    expect(wellFormed).not.toContain('<img');
    expect(wellFormed).not.toContain('127.0.0.1');
    expect(malformed).toBe('<p>before</p>');
  });
});

describe('IPv6 literal URL support', () => {
  it('accepts a public IPv6 literal without performing DNS resolution', async () => {
    const resolver = vi.fn(async () => {
      throw new Error('resolver must not be called for an IP literal');
    });
    const policy = new PublicUrlSecurityPolicy(
      { allowedPorts: [80, 443], allowHttp: true },
      resolver,
    );

    await expect(policy.assertAllowed('https://[2606:4700:4700::1111]/docs#section')).resolves.toEqual(
      {
        value: 'https://[2606:4700:4700::1111]/docs',
        hostname: '2606:4700:4700::1111',
        addresses: ['2606:4700:4700::1111'],
      },
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects a private IPv6 literal under the SSRF address policy', async () => {
    const resolver = vi.fn(async () => ['8.8.8.8']);
    const policy = new PublicUrlSecurityPolicy(
      { allowedPorts: [80, 443], allowHttp: true },
      resolver,
    );

    await expect(policy.assertAllowed('https://[::1]/private')).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('preserves bracketed transport syntax while exposing the normalized IP domain', () => {
    const url = WebUrl.createTransport('https://[2606:4700:4700::1111]/docs#section');

    expect(url.value).toBe('https://[2606:4700:4700::1111]/docs');
    expect(url.domain.value).toBe('2606:4700:4700::1111');
    expect(url.domain.matches('[2606:4700:4700::1111]')).toBe(true);
    expect(url.domain.matches('[2606:4700:4700::1112]')).toBe(false);
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
