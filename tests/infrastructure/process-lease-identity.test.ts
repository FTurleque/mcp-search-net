import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';
import { readProcessIdentity } from '../../src/infrastructure/process-identity.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('process lifetime identity', () => {
  it('returns a stable OS-backed identity for the current process', () => {
    const first = readProcessIdentity(process.pid);
    const second = readProcessIdentity(process.pid);
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('recovers a stale file lease when the PID belongs to a different process lifetime', () => {
    const root = createRoot('mcp-file-identity-');
    const lockPath = join(root, 'maintenance.lock');
    let now = 1_000;
    const clock = { now: () => new Date(now) };
    const original = new FileLeaseLock(lockPath, {
      staleAfterMs: 1_000,
      clock,
      pid: 404,
      hostname: 'test-host',
      ownerTokenFactory: () => 'original-owner',
      processAlive: () => true,
      processIdentity: () => 'process-lifetime-a',
    }).acquire();

    now = 10_000;
    const replacement = new FileLeaseLock(lockPath, {
      staleAfterMs: 1_000,
      clock,
      pid: 505,
      hostname: 'test-host',
      ownerTokenFactory: () => 'replacement-owner',
      processAlive: (pid) => pid === 404,
      processIdentity: (pid) =>
        pid === 404 ? 'process-lifetime-b' : 'replacement-process-lifetime',
    }).acquire();

    expect(replacement.metadata.ownerToken).toBe('replacement-owner');
    expect(() => original.renew()).toThrow('Lock ownership changed unexpectedly');
    original.release();
    replacement.release();
  });

  it('recovers a stale sync run when a live PID has been reused by another process lifetime', async () => {
    const root = createRoot('mcp-sync-identity-');
    const path = join(root, 'catalog.db');
    let now = 1_000;
    const clock = { now: () => new Date(now) };
    const owner = new SqliteCatalogRepository(path, clock, {
      syncRunLease: {
        pid: 606,
        hostname: 'test-host',
        ownerTokenFactory: () => 'sync-owner',
        processAlive: () => true,
        processIdentity: () => 'process-lifetime-a',
        abandonedAfterMs: 1_000,
      },
    });
    repositories.push(owner);
    const run = await owner.startCatalogSyncRun({ startedAt: new Date(now) });
    owner.close();
    repositories.splice(repositories.indexOf(owner), 1);

    now = 10_000;
    const observer = new SqliteCatalogRepository(path, clock, {
      syncRunLease: {
        pid: 707,
        hostname: 'test-host',
        ownerTokenFactory: () => 'observer-owner',
        processAlive: (pid) => pid === 606,
        processIdentity: (pid) =>
          pid === 606 ? 'process-lifetime-b' : 'observer-process-lifetime',
        abandonedAfterMs: 1_000,
      },
    });
    repositories.push(observer);

    const database = new Database(path, { readonly: true });
    try {
      expect(
        database
          .prepare<
            [number],
            {
              status: string;
              owner_token: string | null;
              owner_process_identity: string | null;
            }
          >('SELECT status, owner_token, owner_process_identity FROM sync_runs WHERE id = ?')
          .get(run.id),
      ).toEqual({
        status: 'FAILED',
        owner_token: null,
        owner_process_identity: null,
      });
    } finally {
      database.close();
    }
  });
});

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
