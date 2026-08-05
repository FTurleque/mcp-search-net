import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContainer } from '../../src/bootstrap/container.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('runtime database configuration', () => {
  it('opens cache and catalog databases at their independently configured paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-runtime-paths-'));
    const cachePath = join(root, 'cache', 'cache.sqlite');
    const catalogPath = join(root, 'catalog', 'restored-catalog.sqlite');
    process.env['MCP_CACHE_PATH'] = cachePath;
    process.env['MCP_CATALOG_PATH'] = catalogPath;

    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const container = createContainer(loaded);

    try {
      expect(loaded.application.cache.path).toBe(cachePath);
      expect(loaded.catalogPath).toBe(catalogPath);
      expect(existsSync(cachePath)).toBe(true);
      expect(existsSync(catalogPath)).toBe(true);
      expect(existsSync(join(dirname(cachePath), 'catalog.db'))).toBe(false);
    } finally {
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
