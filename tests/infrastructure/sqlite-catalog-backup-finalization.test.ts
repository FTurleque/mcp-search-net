import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogBackup } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];

describe('SqliteCatalogBackup finalization', () => {
  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('returns success when temporary cleanup fails once after publication and a retry succeeds', async () => {
    const fixture = createCatalogFixture();
    let cleanupAttempts = 0;

    const result = await new SqliteCatalogBackup(fixture.path, fixture.clock, {
      removeTemporaryFile: (path) => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) throw new Error('injected cleanup failure');
        rmSync(path, { force: true });
      },
    }).run('cleanup-retry.db');

    expect(result.status).toBe('backed_up');
    expect(cleanupAttempts).toBe(2);
    expect(existsSync(result.destinationPath)).toBe(true);
    expect(readdirSync(join(fixture.root, 'backups')).filter((name) => name.startsWith('.partial-'))).toEqual([]);
  });

  it('keeps a published backup successful and reports persistent temporary cleanup failure', async () => {
    const fixture = createCatalogFixture();
    let cleanupAttempts = 0;
    const cleanupFailures: Array<{ path: string; error: unknown }> = [];

    const result = await new SqliteCatalogBackup(fixture.path, fixture.clock, {
      removeTemporaryFile: () => {
        cleanupAttempts += 1;
        throw new Error('persistent cleanup failure');
      },
      onTemporaryCleanupFailure: (path, error) => cleanupFailures.push({ path, error }),
    }).run('cleanup-warning.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect(cleanupAttempts).toBe(3);
    expect(cleanupFailures).toHaveLength(1);
    expect(cleanupFailures[0]?.path).toContain('.partial-');
    expect(cleanupFailures[0]?.error).toBeInstanceOf(Error);
  });
});

function createCatalogFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-backup-finalization-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date('2026-08-16T18:30:00.000Z') };
  const catalog = new SqliteCatalogRepository(path, clock);
  catalog.close();
  return { clock, path, root };
}
