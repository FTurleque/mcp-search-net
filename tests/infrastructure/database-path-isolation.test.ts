import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

const originalEnvironment = { ...process.env };
const roots: string[] = [];

afterEach(() => {
  process.env = { ...originalEnvironment };
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('cache and catalog physical path isolation', () => {
  it('rejects distinct path names that are hard links to the same database file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-db-isolation-'));
    roots.push(root);
    const cachePath = join(root, 'cache.sqlite');
    const catalogPath = join(root, 'catalog.db');
    writeFileSync(cachePath, 'same-physical-file');
    linkSync(cachePath, catalogPath);

    process.env['MCP_CACHE_PATH'] = cachePath;
    process.env['MCP_CATALOG_PATH'] = catalogPath;

    await expect(loadConfiguration(resolve('config/application.yml'))).rejects.toThrow(
      'Cache and catalog paths must be different',
    );
  });
});
