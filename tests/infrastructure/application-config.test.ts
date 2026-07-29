import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applicationConfigSchema,
  applicationEnvironmentSchema,
} from '../../src/infrastructure/config/application-config.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

const originalEnvironment = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('application configuration precedence and limits', () => {
  it('provides internal safe defaults', () => {
    const config = applicationConfigSchema.parse({});
    expect(config).toMatchObject({
      application: { profile: 'development' },
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

  it('validates the documented environment contract', () => {
    expect(
      applicationEnvironmentSchema.safeParse({
        MCP_LOG_LEVEL: 'debug',
        MCP_SEARXNG_URL: 'http://127.0.0.1:8888',
        MCP_CRAWL4AI_TOKEN: 'a-secure-local-token',
        MCP_ALLOWED_PUBLIC_PORTS: '80,443,8443',
      }).success,
    ).toBe(true);
    expect(
      applicationEnvironmentSchema.safeParse({ MCP_SEARXNG_URL: 'file:///tmp/socket' }).success,
    ).toBe(false);
    expect(
      applicationEnvironmentSchema.safeParse({ MCP_ALLOWED_PUBLIC_PORTS: '80,0,70000' }).success,
    ).toBe(false);
  });

  it('applies validated environment overrides after YAML', async () => {
    process.env['MCP_SEARCH_CACHE_ENABLED'] = 'false';
    process.env['MCP_LOG_LEVEL'] = 'debug';
    process.env['MCP_SEARXNG_URL'] = 'http://searxng.internal:8080';
    process.env['MCP_CRAWL4AI_TOKEN'] = 'test-token-from-environment';
    process.env['MCP_ALLOWED_PUBLIC_PORTS'] = '80,443,8443';
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    expect(loaded.application.cache.enabled).toBe(false);
    expect(loaded.application.logging.level).toBe('debug');
    expect(loaded.application.searxng.baseUrl).toBe('http://searxng.internal:8080');
    expect(loaded.crawl4aiApiToken).toBe('test-token-from-environment');
    expect(loaded.application.security.allowedPorts).toEqual([80, 443, 8443]);
  });

  it('rejects known development tokens outside the development profile', async () => {
    process.env['MCP_PROFILE'] = 'production';
    process.env['MCP_CRAWL4AI_TOKEN'] = 'mcp-search-local-development-token';

    await expect(loadConfiguration(resolve('config/application.yml'))).rejects.toThrow(
      'A known development Crawl4AI token is forbidden in the production profile',
    );
  });

  it('accepts a non-default secret in the production profile', async () => {
    process.env['MCP_PROFILE'] = 'production';
    process.env['MCP_CRAWL4AI_TOKEN'] = 'unique-production-token-value';

    const loaded = await loadConfiguration(resolve('config/application.yml'));

    expect(loaded.application.application.profile).toBe('production');
    expect(loaded.crawl4aiApiToken).toBe('unique-production-token-value');
  });

  it('rejects an invalid legacy boolean override instead of casting a string to boolean', async () => {
    process.env['MCP_SEARCH_CACHE_ENABLED'] = 'sometimes';

    await expect(loadConfiguration(resolve('config/application.yml'))).rejects.toThrow(
      'Environment variable MCP_SEARCH_CACHE_ENABLED must be a boolean',
    );
  });
});
