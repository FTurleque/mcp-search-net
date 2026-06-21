import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applicationConfigSchema } from '../../src/infrastructure/config/application-config.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

const originalEnvironment = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('application configuration precedence and limits', () => {
  it('provides internal safe defaults', () => {
    const config = applicationConfigSchema.parse({});
    expect(config).toMatchObject({
      cache: { enabled: true, searchTtlMs: 3_600_000, documentationTtlMs: 86_400_000 },
      limits: {
        defaultSearchResults: 5,
        maxSearchResults: 10,
        defaultFetchChars: 12_000,
        maxFetchChars: 30_000,
      },
      security: { maxDownloadBytes: 10_485_760, maxRedirects: 5 },
    });
  });

  it('rejects YAML values above absolute V1 maxima', () => {
    expect(applicationConfigSchema.safeParse({ limits: { maxFetchChars: 30_001 } }).success).toBe(
      false,
    );
    expect(applicationConfigSchema.safeParse({ limits: { maxSearchResults: 11 } }).success).toBe(
      false,
    );
    expect(applicationConfigSchema.safeParse({ security: { maxRedirects: 6 } }).success).toBe(
      false,
    );
  });

  it('applies validated environment overrides after YAML', async () => {
    process.env['MCP_SEARCH_CACHE_ENABLED'] = 'false';
    process.env['MCP_SEARCH_LOG_LEVEL'] = 'debug';
    process.env['MCP_SEARCH_SEARXNG_URL'] = 'http://searxng.internal:8080';
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    expect(loaded.application.cache.enabled).toBe(false);
    expect(loaded.application.logging.level).toBe('debug');
    expect(loaded.application.searxng.baseUrl).toBe('http://searxng.internal:8080');
  });
});
