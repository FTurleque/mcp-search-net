import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

interface SyncRunRow {
  readonly status: string;
  readonly completed_at: number | null;
  readonly error_summary: string | null;
  readonly owner_token: string | null;
  readonly owner_pid: number | null;
  readonly owner_hostname: string | null;
  readonly heartbeat_at: number | null;
}

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog sync run recovery', () => {
  it('marks a run failed on reopen when its same-host owner process is gone', async () => {
    const { path, clock, setNow } = fixture();
    const owner = repository(path, clock, {
      pid: 101,
      hostname: 'test-host',
      ownerTokenFactory: () => 'owner-token-1',
      processAlive: () => true,
    });
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(1_000) });
    owner.close();

    setNow(2_000);
    const recovered = repository(path, clock, {
      pid: 202,
      hostname: 'test-host',
      ownerTokenFactory: () => 'owner-token-2',
      processAlive: (pid) => pid !== 101,
    });
    recovered.close();

    expect(readRun(path, run.id)).toMatchObject({
      status: 'FAILED',
      completed_at: 2_000,
      owner_token: null,
      owner_pid: null,
      owner_hostname: null,
      heartbeat_at: 2_000,
    });
    expect(readRun(path, run.id).error_summary).toContain('Synchronization interrupted');
  });

  it('does not recover a recent run whose same-host owner is still alive', async () => {
    const { path, clock, setNow } = fixture();
    const owner = repository(path, clock, {
      pid: 111,
      hostname: 'test-host',
      ownerTokenFactory: () => 'live-owner-token',
      processAlive: () => true,
    });
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(1_000) });

    setNow(2_000);
    const observer = repository(path, clock, {
      pid: 222,
      hostname: 'test-host',
      ownerTokenFactory: () => 'observer-token',
      processAlive: (pid) => pid === 111,
    });

    expect(readRun(path, run.id)).toMatchObject({
      status: 'RUNNING',
      completed_at: null,
      owner_token: 'live-owner-token',
      owner_pid: 111,
      owner_hostname: 'test-host',
      heartbeat_at: 1_000,
    });

    observer.close();
    setNow(3_000);
    await expect(
      owner.completeCatalogSyncRun(run.id, {
        completedAt: new Date(3_000),
        status: 'SUCCESS',
        documentsChecked: 0,
        documentsAdded: 0,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS', completedAt: new Date(3_000) });
    owner.close();
  });

  it('uses the default process liveness probe for a live local owner', async () => {
    const { path, clock, setNow } = fixture();
    const owner = repository(path, clock, {
      pid: process.pid,
      hostname: 'test-host',
      ownerTokenFactory: () => 'current-process-token',
    });
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(1_000) });

    setNow(2_000);
    const observer = repository(path, clock, {
      pid: process.pid,
      hostname: 'test-host',
      ownerTokenFactory: () => 'observer-current-process-token',
    });

    expect(readRun(path, run.id)).toMatchObject({
      status: 'RUNNING',
      completed_at: null,
      owner_token: 'current-process-token',
      owner_pid: process.pid,
      owner_hostname: 'test-host',
    });

    observer.close();
    owner.close();
  });

  it('fences the former owner after another process recovers its abandoned run', async () => {
    const { path, clock, setNow } = fixture();
    const owner = repository(path, clock, {
      pid: 121,
      hostname: 'test-host',
      ownerTokenFactory: () => 'stale-owner-token',
      processAlive: () => true,
    });
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(1_000) });

    setNow(2_000);
    const recovery = repository(path, clock, {
      pid: 232,
      hostname: 'test-host',
      ownerTokenFactory: () => 'recovery-token',
      processAlive: (pid) => pid !== 121,
    });
    recovery.close();

    await expect(
      owner.completeCatalogSyncRun(run.id, {
        completedAt: new Date(3_000),
        status: 'SUCCESS',
        documentsChecked: 0,
        documentsAdded: 0,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
      }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
    owner.close();
  });

  it('recovers an owner from another host only after the lease timeout', async () => {
    const { path, clock, setNow } = fixture();
    const owner = repository(path, clock, {
      pid: 131,
      hostname: 'host-a',
      ownerTokenFactory: () => 'remote-owner-token',
      processAlive: () => true,
      abandonedAfterMs: 10_000,
    });
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(1_000) });
    owner.close();

    setNow(5_000);
    const earlyObserver = repository(path, clock, {
      pid: 242,
      hostname: 'host-b',
      processAlive: () => false,
      abandonedAfterMs: 10_000,
    });
    earlyObserver.close();
    expect(readRun(path, run.id).status).toBe('RUNNING');

    setNow(12_000);
    const lateObserver = repository(path, clock, {
      pid: 243,
      hostname: 'host-b',
      processAlive: () => false,
      abandonedAfterMs: 10_000,
    });
    lateObserver.close();
    expect(readRun(path, run.id).status).toBe('FAILED');
  });
});

function fixture(): {
  readonly path: string;
  readonly clock: { now: () => Date };
  readonly setNow: (value: number) => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'mcp-sync-recovery-'));
  roots.push(root);
  let now = 1_000;
  return {
    path: join(root, 'catalog.db'),
    clock: { now: () => new Date(now) },
    setNow: (value) => {
      now = value;
    },
  };
}

function repository(
  path: string,
  clock: { now: () => Date },
  syncRunLease: {
    readonly pid: number;
    readonly hostname: string;
    readonly ownerTokenFactory?: () => string;
    readonly processAlive?: (pid: number) => boolean;
    readonly abandonedAfterMs?: number;
  },
): SqliteCatalogRepository {
  return new SqliteCatalogRepository(path, clock, { syncRunLease });
}

function readRun(path: string, id: number): SyncRunRow {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare<[number], SyncRunRow>(
        `SELECT status, completed_at, error_summary, owner_token, owner_pid,
                owner_hostname, heartbeat_at
         FROM sync_runs WHERE id = ?`,
      )
      .get(id);
    if (row === undefined) throw new Error('SYNC_RUN_NOT_FOUND');
    return row;
  } finally {
    database.close();
  }
}
