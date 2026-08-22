import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog sync recovery writer lock scope', () => {
  it('runs process identity probes before reserving the writer and CAS-protects a renewed lease', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-sync-recovery-lock-scope-'));
    roots.push(root);
    const path = join(root, 'catalog.db');
    let now = 1_000;
    const clock = { now: () => new Date(now) };

    const owner = new SqliteCatalogRepository(path, clock, {
      syncRunLease: {
        pid: 171,
        hostname: 'test-host',
        processAlive: () => true,
        processIdentity: () => 'owner-lifetime',
        abandonedAfterMs: 1_000,
      },
    });
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(now) });
    owner.close();

    now = 3_000;
    let concurrentHeartbeatWrites = 0;
    const observer = new SqliteCatalogRepository(path, clock, {
      syncRunLease: {
        pid: 272,
        hostname: 'test-host',
        processAlive: (pid) => pid === 171,
        processIdentity: (pid) => {
          if (pid !== 171) return 'observer-lifetime';
          const concurrent = new Database(path);
          try {
            concurrent.pragma('busy_timeout = 0');
            concurrentHeartbeatWrites += concurrent
              .prepare('UPDATE sync_runs SET heartbeat_at = ? WHERE id = ?')
              .run(now, run.id).changes;
          } finally {
            concurrent.close();
          }
          return undefined;
        },
        abandonedAfterMs: 1_000,
      },
    });
    observer.close();

    expect(concurrentHeartbeatWrites).toBeGreaterThan(0);
    expect(readRun(path, run.id)).toMatchObject({
      status: 'RUNNING',
      completed_at: null,
      heartbeat_at: 3_000,
      owner_pid: 171,
      owner_hostname: 'test-host',
    });
    expect(readRun(path, run.id).owner_token).not.toBeNull();
  });
});

interface SyncRunRow {
  readonly status: string;
  readonly completed_at: number | null;
  readonly heartbeat_at: number | null;
  readonly owner_token: string | null;
  readonly owner_pid: number | null;
  readonly owner_hostname: string | null;
}

function readRun(path: string, id: number): SyncRunRow {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare<[number], SyncRunRow>(
        `SELECT status, completed_at, heartbeat_at, owner_token, owner_pid, owner_hostname
         FROM sync_runs WHERE id = ?`,
      )
      .get(id);
    if (row === undefined) throw new Error('SYNC_RUN_NOT_FOUND');
    return row;
  } finally {
    database.close();
  }
}
