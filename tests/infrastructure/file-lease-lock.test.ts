import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import type { Logger } from '../../src/application/ports/logger.js';
import {
  FileLeaseLock,
  FileLeaseLockError,
} from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];
const children: ChildProcess[] = [];

interface ChildReadyMessage {
  readonly type: 'ready';
  readonly root: string;
  readonly lockPath: string;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
    await waitForExit(child).catch(() => undefined);
  }
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('FileLeaseLock', () => {
  it('records ownership, renews its heartbeat and never removes a live owner by age alone', () => {
    const fixture = createFixture();
    const first = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'first-owner',
    }).acquire();

    fixture.advance(10_000);
    expect(() =>
      new FileLeaseLock(fixture.lockPath, {
        staleAfterMs: 1_000,
        clock: fixture.clock,
      }).acquire(),
    ).toThrow(FileLeaseLockError);

    first.renew();
    const metadata = JSON.parse(readFileSync(`${fixture.lockPath}.heartbeat`, 'utf8')) as {
      readonly ownerToken: string;
      readonly pid: number;
      readonly heartbeatAt: string;
    };
    expect(metadata).toMatchObject({
      ownerToken: 'first-owner',
      pid: process.pid,
      heartbeatAt: fixture.clock.now().toISOString(),
    });

    first.release();
    expect(existsSync(fixture.lockPath)).toBe(false);
    expect(existsSync(`${fixture.lockPath}.heartbeat`)).toBe(false);
  });

  it('rolls back the active lock when initial heartbeat creation fails', () => {
    const fixture = createFixture();
    const heartbeatError = new Error('HEARTBEAT_WRITE_FAILED');
    const lock = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'failed-heartbeat-owner',
      writeHeartbeatFile: () => {
        throw heartbeatError;
      },
    });

    let thrown: unknown;
    try {
      lock.acquire();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(heartbeatError);
    expect(existsSync(fixture.lockPath)).toBe(false);
    expect(existsSync(`${fixture.lockPath}.heartbeat`)).toBe(false);
  });

  it('quarantines a failed acquisition when direct rollback unlink is transiently blocked', () => {
    const fixture = createFixture();
    const heartbeatError = new Error('HEARTBEAT_WRITE_FAILED');
    let lockUnlinkAttempts = 0;
    const lock = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'failed-heartbeat-owner',
      writeHeartbeatFile: (path, content) => {
        writeFileSync(path, content.slice(0, 8), 'utf8');
        throw heartbeatError;
      },
      unlinkFile: (path) => {
        if (path === fixture.lockPath) {
          lockUnlinkAttempts += 1;
          throw fileSystemError('EPERM', 'transient acquire rollback unlink failure');
        }
        unlinkSync(path);
      },
    });

    let thrown: unknown;
    try {
      lock.acquire();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(heartbeatError);
    expect(lockUnlinkAttempts).toBe(1);
    expect(heartbeatError.cause).toBeInstanceOf(Error);
    expect(existsSync(fixture.lockPath)).toBe(false);
    expect(existsSync(`${fixture.lockPath}.heartbeat`)).toBe(false);

    const next = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'next-owner',
    }).acquire();
    expect(next.metadata.ownerToken).toBe('next-owner');
    next.release();
    expect(existsSync(fixture.lockPath)).toBe(false);
  });

  it('keeps the active namespace free when heartbeat and quarantine cleanup both fail', () => {
    const fixture = createFixture();
    const heartbeatError = new Error('HEARTBEAT_WRITE_FAILED');
    const recording = createRecordingLogger();
    let quarantineDeleteAttempts = 0;
    const lock = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      logger: recording.logger,
      ownerTokenFactory: () => 'cleanup-failure-owner',
      writeHeartbeatFile: (path, content) => {
        writeFileSync(path, content.slice(0, 8), 'utf8');
        throw heartbeatError;
      },
      unlinkFile: (path) => {
        if (path.endsWith('.heartbeat')) {
          throw fileSystemError('EBUSY', 'heartbeat cleanup busy');
        }
        if (path === fixture.lockPath) {
          throw fileSystemError('EPERM', 'active lock cleanup denied');
        }
        if (path.includes('.failed-acquire-')) {
          quarantineDeleteAttempts += 1;
          throw fileSystemError('EBUSY', 'quarantine cleanup busy');
        }
        unlinkSync(path);
      },
    });

    expect(() => lock.acquire()).toThrow(heartbeatError);
    expect(heartbeatError.cause).toBeInstanceOf(AggregateError);
    expect((heartbeatError.cause as AggregateError).errors.length).toBe(3);
    expect(quarantineDeleteAttempts).toBe(1);
    expect(recording.warnings).toContain('file_lease_lock_acquire_quarantine_cleanup_failed');
    expect(existsSync(fixture.lockPath)).toBe(false);
    expect(existsSync(`${fixture.lockPath}.heartbeat`)).toBe(true);

    const next = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'replacement-owner',
    }).acquire();
    next.release();
    expect(existsSync(fixture.lockPath)).toBe(false);
    expect(existsSync(`${fixture.lockPath}.heartbeat`)).toBe(false);
  });

  it('reports and preserves the active lock when every rollback primitive is unavailable', () => {
    const fixture = createFixture();
    const originalCause = new Error('ORIGINAL_HEARTBEAT_CAUSE');
    const heartbeatError = new Error('HEARTBEAT_WRITE_FAILED', { cause: originalCause });
    const recording = createRecordingLogger();
    let renameAttempts = 0;
    let unlinkAttempts = 0;
    const lock = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      logger: recording.logger,
      ownerTokenFactory: () => 'unrecoverable-owner',
      writeHeartbeatFile: () => {
        throw heartbeatError;
      },
      unlinkFile: (path) => {
        if (path === fixture.lockPath) {
          unlinkAttempts += 1;
          throw fileSystemError('EPERM', 'active lock cleanup denied');
        }
        unlinkSync(path);
      },
      renameFile: () => {
        renameAttempts += 1;
        throw fileSystemError('EBUSY', 'active lock quarantine busy');
      },
    });

    expect(() => lock.acquire()).toThrow(heartbeatError);
    expect(unlinkAttempts).toBe(3);
    expect(renameAttempts).toBe(3);
    expect(heartbeatError.cause).toBeInstanceOf(AggregateError);
    expect((heartbeatError.cause as AggregateError).errors[0]).toBe(originalCause);
    expect(recording.errors).toContain('file_lease_lock_acquire_rollback_failed');
    expect(existsSync(fixture.lockPath)).toBe(true);
  });

  it('does not delete a lock whose ownership changes during failed-acquire cleanup', () => {
    const fixture = createFixture();
    const heartbeatError = new Error('HEARTBEAT_WRITE_FAILED');
    const timestamp = fixture.clock.now().toISOString();
    const foreignMetadata = {
      schemaVersion: '1.0',
      ownerToken: 'foreign-owner',
      pid: 123,
      hostname: 'foreign-host',
      createdAt: timestamp,
      heartbeatAt: timestamp,
    } as const;
    const lock = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'initial-owner',
      writeHeartbeatFile: (path, content) => {
        writeFileSync(path, content, 'utf8');
        throw heartbeatError;
      },
      unlinkFile: (path) => {
        if (path.endsWith('.heartbeat')) {
          writeFileSync(fixture.lockPath, `${JSON.stringify(foreignMetadata)}\n`, 'utf8');
        }
        unlinkSync(path);
      },
    });

    expect(() => lock.acquire()).toThrow(heartbeatError);
    expect(JSON.parse(readFileSync(fixture.lockPath, 'utf8'))).toMatchObject({
      ownerToken: 'foreign-owner',
    });
    expect(heartbeatError.cause).toBeUndefined();
  });

  it('accepts ENOENT when the active lock disappears during failed-acquire cleanup', () => {
    const fixture = createFixture();
    const heartbeatError = new Error('HEARTBEAT_WRITE_FAILED');
    const lock = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'disappearing-owner',
      writeHeartbeatFile: () => {
        throw heartbeatError;
      },
      unlinkFile: (path) => {
        if (path === fixture.lockPath) {
          unlinkSync(path);
          throw fileSystemError('ENOENT', 'lock disappeared after unlink');
        }
        unlinkSync(path);
      },
    });

    expect(() => lock.acquire()).toThrow(heartbeatError);
    expect(heartbeatError.cause).toBeUndefined();
    expect(existsSync(fixture.lockPath)).toBe(false);
  });

  it('recovers only a stale local lock whose owner is confirmed dead', () => {
    const fixture = createFixture();
    const abandoned = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      pid: 2_000_000_000,
      ownerTokenFactory: () => 'dead-owner',
      processAlive: () => false,
    }).acquire();
    fixture.advance(10_000);

    const recovered = new FileLeaseLock(fixture.lockPath, {
      staleAfterMs: 1_000,
      clock: fixture.clock,
      ownerTokenFactory: () => 'new-owner',
      processAlive: () => false,
    }).acquire();

    expect(recovered.metadata.ownerToken).toBe('new-owner');
    expect(() => abandoned.renew()).toThrow('Lock ownership changed unexpectedly');
    expect(JSON.parse(readFileSync(fixture.lockPath, 'utf8'))).toMatchObject({
      ownerToken: 'new-owner',
    });
    abandoned.release();
    expect(existsSync(fixture.lockPath)).toBe(true);
    recovered.release();
    expect(existsSync(fixture.lockPath)).toBe(false);
  });

  it('refuses to delete invalid or foreign-owner metadata automatically', () => {
    const fixture = createFixture();
    writeFileSync(fixture.lockPath, '{invalid', 'utf8');
    expect(() =>
      new FileLeaseLock(fixture.lockPath, {
        staleAfterMs: 1,
        clock: fixture.clock,
        processAlive: () => false,
      }).acquire(),
    ).toThrow('manual recovery is required');

    rmSync(fixture.lockPath, { force: true });
    writeFileSync(
      fixture.lockPath,
      JSON.stringify({
        schemaVersion: '1.0',
        ownerToken: 'foreign-owner',
        pid: 123,
        hostname: 'another-host',
        createdAt: '2020-01-01T00:00:00.000Z',
        heartbeatAt: '2020-01-01T00:00:00.000Z',
      }),
      'utf8',
    );
    expect(() =>
      new FileLeaseLock(fixture.lockPath, {
        staleAfterMs: 1,
        clock: fixture.clock,
        processAlive: () => false,
      }).acquire(),
    ).toThrow('Lock is owned by pid 123 on another-host');
  });

  it('blocks a real concurrent process even when a contender sees an expired lease', async () => {
    const child = fork(resolve('tests/fixtures/hold-file-lease-lock.ts'), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
    });
    children.push(child);
    const ready = await waitForReady(child);
    roots.push(ready.root);

    const futureClock: Clock = { now: () => new Date('2099-01-01T00:00:00.000Z') };
    expect(() =>
      new FileLeaseLock(ready.lockPath, {
        staleAfterMs: 1,
        clock: futureClock,
      }).acquire(),
    ).toThrow(`Lock is owned by pid ${child.pid}`);

    child.send('release');
    await waitForExit(child);
    expect(existsSync(ready.lockPath)).toBe(false);
  });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-file-lease-'));
  roots.push(root);
  let now = Date.parse('2026-07-29T00:00:00.000Z');
  return {
    root,
    lockPath: join(root, 'maintenance.lock'),
    clock: { now: () => new Date(now) },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function createRecordingLogger(): {
  readonly logger: Logger;
  readonly warnings: string[];
  readonly errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    logger: {
      record: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warning: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
  };
}

function fileSystemError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function waitForReady(child: ChildProcess): Promise<ChildReadyMessage> {
  return new Promise<ChildReadyMessage>((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error('Timed out waiting for child lock readiness')),
      5_000,
    );
    const onError = (error: Error) => {
      clearTimeout(timeout);
      rejectReady(error);
    };
    child.once('error', onError);
    child.on('message', (message: unknown) => {
      if (!isChildReadyMessage(message)) return;
      clearTimeout(timeout);
      child.off('error', onError);
      resolveReady(message);
    });
  });
}

function isChildReadyMessage(value: unknown): value is ChildReadyMessage {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record['type'] === 'ready' &&
    typeof record['root'] === 'string' &&
    record['root'].length > 0 &&
    typeof record['lockPath'] === 'string' &&
    record['lockPath'].length > 0
  );
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit, rejectExit) => {
    const timeout = setTimeout(
      () => rejectExit(new Error('Timed out waiting for child exit')),
      5_000,
    );
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
  });
}
