import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContainer } from '../../src/bootstrap/container.js';
import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import { CacheUnavailableError } from '../../src/domain/errors/domain-errors.js';
import { applicationConfigSchema } from '../../src/infrastructure/config/application-config.js';
import type { LoadedConfiguration } from '../../src/infrastructure/config/load-configuration.js';

const STUB_REGISTRY = {
  findByUrl: () => undefined,
  findForQuery: () => [],
  list: () => [],
  version: () => 'test',
};

let containers: ReturnType<typeof createContainer>[] = [];
let tmpRoots: string[] = [];

afterEach(async () => {
  for (const c of containers) {
    await c.mcpServer.close().catch(() => undefined);
    c.cache.close();
    c.catalog.close();
  }
  containers = [];
  for (const r of tmpRoots) {
    rmSync(r, { recursive: true, force: true });
  }
  tmpRoots = [];
});

describe('container cache creation paths', () => {
  it('uses DisabledCacheRepository when cache is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-container-cache-'));
    tmpRoots.push(root);
    const catalogPath = join(root, 'catalog.db');
    const loaded: LoadedConfiguration = {
      application: {
        ...applicationConfigSchema.parse({}),
        cache: {
          ...applicationConfigSchema.parse({}).cache,
          enabled: false,
          path: join(root, 'cache.sqlite'),
        },
      },
      catalogPath,
      officialSources: STUB_REGISTRY,
    };
    const container = createContainer(loaded);
    containers.push(container);
    expect(container.cache).toBeInstanceOf(DisabledCacheRepository);
  });

  it('falls back to DisabledCacheRepository when cache fails and continueOnError is true', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-container-cache-'));
    tmpRoots.push(root);
    const badCachePath = join(root, 'cache.sqlite');
    mkdirSync(badCachePath);
    const catalogPath = join(root, 'catalog.db');
    const loaded: LoadedConfiguration = {
      application: {
        ...applicationConfigSchema.parse({}),
        cache: {
          ...applicationConfigSchema.parse({}).cache,
          enabled: true,
          continueOnError: true,
          path: badCachePath,
        },
      },
      catalogPath,
      officialSources: STUB_REGISTRY,
    };
    const container = createContainer(loaded);
    containers.push(container);
    expect(container.cache).toBeInstanceOf(DisabledCacheRepository);
  });

  it('throws CacheUnavailableError when cache fails and continueOnError is false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-container-cache-'));
    tmpRoots.push(root);
    const badCachePath = join(root, 'cache.sqlite');
    mkdirSync(badCachePath);
    const catalogPath = join(root, 'catalog.db');
    const loaded: LoadedConfiguration = {
      application: {
        ...applicationConfigSchema.parse({}),
        cache: {
          ...applicationConfigSchema.parse({}).cache,
          enabled: true,
          continueOnError: false,
          path: badCachePath,
        },
      },
      catalogPath,
      officialSources: STUB_REGISTRY,
    };
    expect(() => createContainer(loaded)).toThrow(CacheUnavailableError);
  });
});
