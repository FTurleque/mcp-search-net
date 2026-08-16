import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FileLeaseLock,
  FileLeaseLockError,
} from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('FileLeaseLock recovery safety', () => {
  it('publishes renewals from a complete staging file without truncating the live heartbeat', () => {
    const fixture = createFixture();
    let writes = 0;
    let heartbeatObservedDuringRenew: string | undefined;
    const lease = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'atomic-owner',
      writeHeartbeatFile: (path, content) => {
        writes += 1;
        if (writes === 2) {
          const heartbeatPath = heartbeatFileForOwner(fixture.lockPath, 'atomic-owner');
          expect(heartbeatPath).toBeDefined();
          heartbeatObservedDuringRenew = readFileSync(heartbeatPath ?? '', 'utf8');
          expect(path).not.toBe(heartbeatPath);
        }
        writeFileSync(path, content, 'utf8');
      },
    }).acquire();

    const initialHeartbeat = heartbeatObservedAt(fixture.lockPath, 'atomic-owner');
    fixture.advance(5_000);
    lease.renew();

    expect(writes).toBe(2);
    expect(JSON.parse(heartbeatObservedDuringRenew ?? '{}')).toMatchObject({
      ownerToken: 'atomic-owner',
      heartbeatAt: initialHeartbeat,
    });
    expect(heartbeatObservedAt(fixture.lockPath, 'atomic-owner')).toBe(
      fixture.clock.now().toISOString(),
    );
    lease.release();
  });

  it('never recovers an expired lease from a live PID when process identity is unavailable', () => {
    const fixture = createFixture();
    const owner = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      pid: 4_242,
      ownerTokenFactory: () => 'live-ambiguous-owner',
      processIdentity: () => undefined,
    }).acquire();

    fixture.advance(10_000);
    expect(() =>
      new FileLeaseLock(fixture.lockPath, {
        staleAfterMs: 1_000,
        clock: fixture.clock,
        pid: 9_999,
        ownerTokenFactory: () => 'contender',
        processAlive: () => true,
        processIdentity: () => undefined,
      }).acquire(),
    ).toThrow(FileLeaseLockError);

    expect(readLockOwner(fixture.lockPath)).toBe('live-ambiguous-owner');
    owner.renew();
    owner.release();
  });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-file-lease-safety-'));
  roots.push(root);
  let now = Date.parse('2026-08-16T00:00:00.000Z');
  return {
    lockPath: join(root, 'maintenance.lock'),
    clock: { now: () => new Date(now) },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function heartbeatObservedAt(lockPath: string, ownerToken: string): string {
  const path = heartbeatFileForOwner(lockPath, ownerToken);
  if (path === undefined) throw new Error('EXPECTED_HEARTBEAT');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { readonly heartbeatAt?: unknown };
  if (typeof parsed.heartbeatAt !== 'string') throw new Error('EXPECTED_HEARTBEAT_TIMESTAMP');
  return parsed.heartbeatAt;
}

function heartbeatFileForOwner(lockPath: string, ownerToken: string): string | undefined {
  const directory = dirname(lockPath);
  const prefix = `${basename(lockPath)}.heartbeat-`;
  return readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(directory, name))
    .find((path) => {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { readonly ownerToken?: unknown };
        return parsed.ownerToken === ownerToken;
      } catch {
        return false;
      }
    });
}

function readLockOwner(lockPath: string): string | undefined {
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as { readonly ownerToken?: unknown };
  return typeof parsed.ownerToken === 'string' ? parsed.ownerToken : undefined;
}
