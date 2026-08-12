import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertDistinctDatabasePaths } from '../../src/infrastructure/config/load-configuration.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('cache and catalog future path isolation', () => {
  it('rejects two missing database paths whose parent directories resolve to the same location', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-db-symlink-isolation-'));
    roots.push(root);
    const realDirectory = join(root, 'real');
    const aliasDirectory = join(root, 'alias');
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    const cachePath = join(aliasDirectory, 'shared.db');
    const catalogPath = join(realDirectory, 'shared.db');
    expect(existsSync(cachePath)).toBe(false);
    expect(existsSync(catalogPath)).toBe(false);

    expect(() => assertDistinctDatabasePaths(cachePath, catalogPath)).toThrow(
      'Cache and catalog paths must be different',
    );
  });

  it('allows genuinely distinct database files that do not exist yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-db-distinct-isolation-'));
    roots.push(root);
    const cacheDirectory = join(root, 'cache');
    const catalogDirectory = join(root, 'catalog');
    mkdirSync(cacheDirectory);
    mkdirSync(catalogDirectory);

    expect(() =>
      assertDistinctDatabasePaths(
        join(cacheDirectory, 'cache.sqlite'),
        join(catalogDirectory, 'catalog.db'),
      ),
    ).not.toThrow();
  });
});
