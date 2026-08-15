import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogMaintenanceInput } from '../../src/application/use-cases/maintain-catalog.js';
import {
  SqliteCatalogMaintenance,
  type SqliteCatalogMaintenanceOptions,
} from '../../src/infrastructure/catalog/sqlite-catalog-maintenance.js';
import { FileLeaseLock, type FileLease } from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-15T15:20:00.000Z') };
const maintenanceInput: CatalogMaintenanceInput = {
  keepSyncRuns: 100,
  maxSyncRunAgeDays: 90,
  staleLockMs: 60_000,
  vacuum: false,
};

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog maintenance lock finalization', () => {
  it('retries a transient lock unlink failure and leaves no lock or heartbeat behind', async () => {
    const catalogPath = createCatalogPath('retry-release');
    let unlinkAttempts = 0;
    const options: SqliteCatalogMaintenanceOptions = {
      releaseAttempts: 3,
      lockFactory: (lockPath, lockOptions) =>
        new FileLeaseLock(lockPath, {
          ...lockOptions,
          ownerTokenFactory: () => 'maintenance-retry-owner',
          processIdentity: () => 'maintenance-retry-process',
          unlinkFile: (path) => {
            unlinkAttempts += 1;
            if (unlinkAttempts === 1) {
              const error = new Error(
                'transient maintenance unlink failure',
              ) as NodeJS.ErrnoException;
              error.code = 'EBUSY';
              throw error;
            }
            unlinkSync(path);
          },
        }),
    };

    await expect(
      new SqliteCatalogMaintenance(catalogPath, clock, undefined, options).run(maintenanceInput),
    ).resolves.toMatchObject({ status: 'maintained', lock: { acquired: true } });

    expect(unlinkAttempts).toBe(2);
    expect(existsSync(`${catalogPath}.maintenance.lock`)).toBe(false);
    expect(existsSync(`${catalogPath}.maintenance.lock.heartbeat`)).toBe(false);
  });

  it('preserves the exact maintenance failure when lock release also exhausts its retries', async () => {
    const catalogPath = createCatalogPath('primary-error');
    const primaryError = new Error('PRIMARY_MAINTENANCE_FAILURE');
    const releaseError = new Error('LOCK_RELEASE_FAILURE');
    let releaseAttempts = 0;
    const lease = fakeLease({
      renew: () => {
        throw primaryError;
      },
      release: () => {
        releaseAttempts += 1;
        throw releaseError;
      },
    });

    const runner = new SqliteCatalogMaintenance(catalogPath, clock, undefined, {
      releaseAttempts: 3,
      lockFactory: () => ({ acquire: () => lease }),
    });

    await expect(runner.run(maintenanceInput)).rejects.toBe(primaryError);
    expect(releaseAttempts).toBe(3);
    expect(primaryError.cause).toBe(releaseError);
  });

  it('fails closed when successful maintenance cannot release its lock after all retries', async () => {
    const catalogPath = createCatalogPath('release-error');
    const releaseError = new Error('LOCK_RELEASE_FAILURE');
    let releaseAttempts = 0;
    const lease = fakeLease({
      renew: () => undefined,
      release: () => {
        releaseAttempts += 1;
        throw releaseError;
      },
    });

    const runner = new SqliteCatalogMaintenance(catalogPath, clock, undefined, {
      releaseAttempts: 2,
      lockFactory: () => ({ acquire: () => lease }),
    });

    await expect(runner.run(maintenanceInput)).rejects.toBe(releaseError);
    expect(releaseAttempts).toBe(2);
  });

  it('rejects an invalid release retry budget', () => {
    expect(
      () =>
        new SqliteCatalogMaintenance(createCatalogPath('invalid-retry'), clock, undefined, {
          releaseAttempts: 0,
        }),
    ).toThrow('releaseAttempts must be a positive safe integer');
  });
});

function createCatalogPath(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `mcp-maintenance-${prefix}-`));
  roots.push(root);
  return join(root, 'catalog.db');
}

function fakeLease(overrides: Pick<FileLease, 'renew' | 'release'>): FileLease {
  const timestamp = clock.now().toISOString();
  return {
    metadata: {
      schemaVersion: '1.1',
      ownerToken: 'fake-maintenance-owner',
      pid: 4242,
      hostname: 'test-host',
      processIdentity: 'test-process',
      createdAt: timestamp,
      heartbeatAt: timestamp,
    },
    ...overrides,
  };
}
