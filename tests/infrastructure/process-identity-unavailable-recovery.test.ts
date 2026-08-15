import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Logger } from '../../src/application/ports/logger.js';
import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';
import { compareProcessIdentity } from '../../src/infrastructure/process-identity.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('process identity unavailable recovery', () => {
  it('keeps an unverified live-pid file lease before its heartbeat timeout', () => {
    const fixture = createFixture();
    const owner = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      pid: 404,
      hostname: 'test-host',
      ownerTokenFactory: () => 'unverified-owner',
      processAlive: () => true,
      processIdentity: () => undefined,
    }).acquire();

    fixture.advance(500);
    expect(() =>
      new FileLeaseLock(fixture.lockPath, {
        staleAfterMs: 1_000,
        clock: fixture.clock,
        pid: 505,
        hostname: 'test-host',
        processAlive: (pid) => pid === 404,
        processIdentity: () => undefined,
      }).acquire(),
    ).toThrow('Lock is owned by pid 404 on test-host');

    owner.release();
  });

  it('reclaims an expired file lease when the pid is alive but process identity is unavailable', () => {
    const fixture = createFixture();
    const recording = createRecordingLogger();
    const owner = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      pid: 404,
      hostname: 'test-host',
      ownerTokenFactory: () => 'stale-unverified-owner',
      processAlive: () => true,
      processIdentity: () => undefined,
    }).acquire();

    fixture.advance(2_000);
    const replacement = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      logger: recording.logger,
      pid: 505,
      hostname: 'test-host',
      ownerTokenFactory: () => 'replacement-owner',
      processAlive: (pid) => pid === 404,
      processIdentity: () => undefined,
    }).acquire();

    expect(replacement.metadata.ownerToken).toBe('replacement-owner');
    expect(recording.warnings).toContain('file_lease_lock_stale_identity_unavailable');
    expect(recording.warnings).toContain('file_lease_lock_stale_recovered');
    expect(() => owner.renew()).toThrow('Lock ownership changed unexpectedly');

    owner.release();
    replacement.release();
  });

  it('retries a transient identity probe before falling back to lease timeout semantics', () => {
    let attempts = 0;
    const result = compareProcessIdentity('process-lifetime-a', 606, () => {
      attempts += 1;
      return attempts === 1 ? undefined : 'process-lifetime-a';
    });

    expect(result).toBe('same');
    expect(attempts).toBe(2);
  });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-unverified-process-identity-'));
  roots.push(root);
  let now = Date.parse('2026-08-15T00:00:00.000Z');
  return {
    lockPath: join(root, 'maintenance.lock'),
    clock: { now: () => new Date(now) },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function createRecordingLogger(): { readonly logger: Logger; readonly warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    logger: {
      record: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warning: (message) => warnings.push(message),
      error: () => undefined,
    },
  };
}
