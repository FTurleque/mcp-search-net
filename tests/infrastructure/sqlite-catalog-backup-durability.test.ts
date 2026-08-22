import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogBackup } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-17T12:00:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogBackup durability commit', () => {
  it('uses the real filesystem durability primitives before reporting success', async () => {
    const fixture = await createCatalogFixture('real-sync');

    const result = await new SqliteCatalogBackup(fixture.catalogPath, clock).run('durable.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
  });

  it('flushes the verified inode, published inode and parent directory in commit order', async () => {
    const fixture = await createCatalogFixture('ordered');
    const events: string[] = [];

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      syncFile: (path) => {
        events.push(`file:${basename(path)}`);
        if (basename(path) === 'ordered.db') expect(existsSync(path)).toBe(true);
        return Promise.resolve();
      },
      syncDirectory: (path) => {
        events.push(`directory:${basename(path)}`);
        expect(existsSync(join(path, 'ordered.db'))).toBe(true);
        return Promise.resolve();
      },
    });

    await backup.run('ordered.db');

    expect(events).toHaveLength(3);
    expect(events[0]).toMatch(/^file:\.partial-/u);
    expect(events.slice(1)).toEqual(['file:ordered.db', 'directory:backups']);
  });

  it('does not publish a backup when the pre-publication file flush fails', async () => {
    const fixture = await createCatalogFixture('pre-publish-failure');
    const destination = join(fixture.root, 'backups', 'pre-publish.db');

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      syncFile: () => Promise.reject(new Error('injected file sync failure')),
      syncDirectory: () => Promise.resolve(),
    });

    await expect(backup.run('pre-publish.db')).rejects.toThrow('CATALOG_BACKUP_DURABILITY_FAILED');
    expect(existsSync(destination)).toBe(false);
  });

  it('rolls back the public name and flushes that rollback when directory sync fails', async () => {
    const fixture = await createCatalogFixture('rollback');
    const destination = join(fixture.root, 'backups', 'rollback.db');
    let directorySyncCalls = 0;

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      syncFile: () => Promise.resolve(),
      syncDirectory: () => {
        directorySyncCalls += 1;
        return directorySyncCalls === 1
          ? Promise.reject(new Error('injected directory sync failure'))
          : Promise.resolve();
      },
    });

    await expect(backup.run('rollback.db')).rejects.toThrow('CATALOG_BACKUP_DURABILITY_FAILED');
    expect(directorySyncCalls).toBe(2);
    expect(existsSync(destination)).toBe(false);
  });

  it('reports an explicit rollback failure when neither publish nor rollback durability can be confirmed', async () => {
    const fixture = await createCatalogFixture('rollback-failure');
    const destination = join(fixture.root, 'backups', 'rollback-failure.db');

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      syncFile: () => Promise.resolve(),
      syncDirectory: () => Promise.reject(new Error('injected persistent directory sync failure')),
    });

    await expect(backup.run('rollback-failure.db')).rejects.toThrow(
      'CATALOG_BACKUP_DURABILITY_ROLLBACK_FAILED',
    );
    expect(existsSync(destination)).toBe(false);
  });
});

async function createCatalogFixture(label: string): Promise<{
  readonly root: string;
  readonly catalogPath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), `mcp-catalog-backup-durability-${label}-`));
  roots.push(root);
  const catalogPath = join(root, 'catalog.db');
  const catalog = new SqliteCatalogRepository(catalogPath, clock);
  await catalog.addSource({
    sourceKey: 'docs',
    displayName: 'Documentation',
    baseUrl: 'https://docs.example/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  catalog.close();
  return { root, catalogPath };
}
