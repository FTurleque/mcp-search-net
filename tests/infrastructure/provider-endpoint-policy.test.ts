import { describe, expect, it } from 'vitest';

import { isSafeProviderEndpoint } from '../../src/infrastructure/config/provider-endpoint-policy.js';

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
  ] as const)('%s -> safe=%s', (url, expected) => {
    expect(isSafeProviderEndpoint(url)).toBe(expected);
  });

  it('accepts the current Windows production configuration', () => {
    expect(isSafeProviderEndpoint('http://127.0.0.1:8888')).toBe(true);
    expect(isSafeProviderEndpoint('http://127.0.0.1:11235')).toBe(true);
  });

  it('accepts the current Docker production configuration', () => {
    expect(isSafeProviderEndpoint('http://searxng:8080')).toBe(true);
    expect(isSafeProviderEndpoint('http://crawl4ai:11235')).toBe(true);
  });
});
