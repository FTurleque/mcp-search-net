import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteCatalogBackup,
  type CatalogBackupCleanupFailure,
} from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T18:00:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogBackup cleanup recovery', () => {
  it('retries a transient cleanup failure and removes the temporary family', async () => {
    const fixture = await createCatalogFixture('retry');
    const attempts = new Map<string, number>();
    const waits: number[] = [];
    const diagnostics: CatalogBackupCleanupFailure[] = [];

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      cleanupAttempts: 3,
      cleanupRetryDelayMs: 7,
      waitForRetry: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
      removeFile: (path) => {
        const attempt = (attempts.get(path) ?? 0) + 1;
        attempts.set(path, attempt);
        if (path.includes('.partial-') && path.endsWith('.db') && attempt === 1) {
          throw cleanupError('transient cleanup failure');
        }
        rmSync(path, { force: true });
      },
      onCleanupFailure: (failure) => diagnostics.push(failure),
    });

    const result = await backup.run('retry.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect(waits).toEqual([7]);
    expect(diagnostics).toEqual([]);
    expect(readdirSync(join(fixture.root, 'backups')).filter((name) => name.startsWith('.partial-'))).toEqual(
      [],
    );
  });

  it('keeps publication successful and reports a persistent cleanup failure once', async () => {
    const fixture = await createCatalogFixture('persistent');
    const diagnostics: CatalogBackupCleanupFailure[] = [];
    let primaryCleanupAttempts = 0;

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      cleanupAttempts: 3,
      cleanupRetryDelayMs: 0,
      waitForRetry: () => Promise.resolve(),
      removeFile: (path) => {
        if (path.includes('.partial-') && path.endsWith('.db')) {
          primaryCleanupAttempts += 1;
          throw cleanupError('persistent cleanup failure');
        }
        rmSync(path, { force: true });
      },
      onCleanupFailure: (failure) => diagnostics.push(failure),
    });

    const result = await backup.run('committed.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect(primaryCleanupAttempts).toBe(3);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ attempts: 3 });
    expect(diagnostics[0]?.path).toContain('.partial-');
    expect((diagnostics[0]?.error as NodeJS.ErrnoException).code).toBe('EPERM');
    expect(
      readdirSync(join(fixture.root, 'backups')).filter((name) => name.startsWith('.partial-')),
    ).toHaveLength(1);
  });
});

async function createCatalogFixture(label: string): Promise<{
  readonly root: string;
  readonly catalogPath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), `mcp-catalog-backup-${label}-`));
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

function cleanupError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'EPERM';
  return error;
}
