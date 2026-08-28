import { describe, expect, it } from 'vitest';

import {
  hasUrlCredentials,
  isSafeProviderEndpoint,
} from '../../src/infrastructure/config/provider-endpoint-policy.js';

describe('provider endpoint policy', () => {
  it.each([
    ['https://remote.example', true],
    ['http://localhost', true],
    ['http://localhost:8888', true],
    ['http://127.0.0.1', true],
    ['http://127.0.0.1:8888', true],
    ['http://[::1]', true],
    ['http://[::1]:8888', true],
    ['http://searxng', true],
    ['http://searxng:8080', true],
    ['http://crawl4ai', true],
    ['http://crawl4ai:11235', true],
    ['http://10.0.0.5', true],
    ['http://172.16.0.5', true],
    ['http://192.168.1.5', true],
    ['http://169.254.1.1', true],
    ['http://100.64.0.1', true],
    ['http://remote.example', false],
    ['http://8.8.8.8', false],
    ['http://mcp-search-net.example.com', false],
    ['not a url', false],
    ['ftp://remote.example', false],
    ['ftp://localhost', false],
    ['file:///etc/passwd', false],
    ['gopher://remote.example', false],
    ['unknown-scheme://remote.example', false],
    ['data:text/plain,hello', false],
    ['javascript:alert(1)', false],
  ] as const)('%s -> safe=%s', (url, expected) => {
    expect(isSafeProviderEndpoint(url)).toBe(expected);
  });

  it('is fail-closed for every non-HTTPS scheme regardless of upstream Zod restrictions', () => {
    for (const scheme of ['ftp', 'file', 'gopher', 'ws', 'wss', 'unknown-scheme']) {
      expect(isSafeProviderEndpoint(`${scheme}://localhost`)).toBe(false);
      expect(isSafeProviderEndpoint(`${scheme}://searxng`)).toBe(false);
    }
  });

  it('accepts the current Windows production configuration', () => {
    expect(isSafeProviderEndpoint('http://127.0.0.1:8888')).toBe(true);
    expect(isSafeProviderEndpoint('http://127.0.0.1:11235')).toBe(true);
  });

  it('accepts the current Docker production configuration', () => {
    expect(isSafeProviderEndpoint('http://searxng:8080')).toBe(true);
    expect(isSafeProviderEndpoint('http://crawl4ai:11235')).toBe(true);
  });

  it.each([
    'https://user:password@remote.example',
    'https://token@remote.example',
    'http://token@localhost',
    'http://token@localhost:8888',
    'http://user:password@searxng:8080',
    'http://user:password@crawl4ai:11235',
    'http://token@127.0.0.1:11235',
  ])('rejects credentials embedded in the provider URL %s regardless of host trust', (url) => {
    expect(isSafeProviderEndpoint(url)).toBe(false);
  });

  it.each([
    ['https://user:password@remote.example', true],
    ['https://token@remote.example', true],
    ['http://token@localhost', true],
    ['https://remote.example', false],
    ['http://searxng:8080', false],
    ['not a url', false],
  ] as const)('hasUrlCredentials(%s) -> %s', (url, expected) => {
    expect(hasUrlCredentials(url)).toBe(expected);
  });
});
