import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Logger } from '../../src/application/ports/logger.js';
import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('file lease stale recovery cleanup', () => {
  it(
    'keeps the active namespace available when stale quarantine and heartbeat cleanup are busy',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'mcp-file-lease-stale-cleanup-'));
      roots.push(root);
      const lockPath = join(root, 'maintenance.lock');
      let now = Date.parse('2026-08-15T00:00:00.000Z');
      const clock = { now: () => new Date(now) };
      const staleLease = new FileLeaseLock(lockPath, {
        staleAfterMs: 1_000,
        clock,
        ownerTokenFactory: () => 'stale-owner',
        processAlive: () => false,
      }).acquire();

      now += 10_000;
      let quarantineAttempts = 0;
      let heartbeatAttempts = 0;
      const warnings: Array<{
        readonly message: string;
        readonly data?: Readonly<Record<string, unknown>>;
      }> = [];
      const recovered = new FileLeaseLock(lockPath, {
        staleAfterMs: 1_000,
        clock,
        ownerTokenFactory: () => 'new-owner',
        processAlive: () => false,
        logger: recordingLogger(warnings),
        unlinkFile: (path) => {
          if (path.includes('.stale-')) {
            quarantineAttempts += 1;
            throw fileSystemError('EBUSY', 'stale quarantine is busy');
          }
          if (path.endsWith('.heartbeat') && heartbeatAttempts < 3) {
            heartbeatAttempts += 1;
            throw fileSystemError('EPERM', 'stale heartbeat is busy');
          }
          unlinkSync(path);
        },
      }).acquire();

      expect(recovered.metadata.ownerToken).toBe('new-owner');
      expect(quarantineAttempts).toBe(3);
      expect(heartbeatAttempts).toBe(3);
      expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
        ownerToken: 'new-owner',
      });
      expect(() => staleLease.renew()).toThrow('Lock ownership changed unexpectedly');

      const cleanupFailures = warnings.filter(
        (entry) => entry.message === 'file_lease_lock_stale_cleanup_failed',
      );
      expect(cleanupFailures).toHaveLength(2);
      expect(cleanupFailures.map((entry) => entry.data?.['target']).sort()).toEqual([
        'heartbeat',
        'quarantine',
      ]);
      expect(
        warnings.some((entry) => entry.message === 'file_lease_lock_stale_recovered'),
      ).toBe(true);
      expect(readdirSync(root).filter((name) => name.includes('.stale-'))).toHaveLength(1);

      recovered.release();
      expect(readdirSync(root).some((name) => name === 'maintenance.lock')).toBe(false);
      expect(readdirSync(root).some((name) => name === 'maintenance.lock.heartbeat')).toBe(false);
    },
  );
});

function recordingLogger(
  warnings: Array<{
    readonly message: string;
    readonly data?: Readonly<Record<string, unknown>>;
  }>,
): Logger {
  return {
    record: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warning: (message, data) =>
      warnings.push({ message, ...(data === undefined ? {} : { data }) }),
    error: () => undefined,
  };
}

function fileSystemError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}
