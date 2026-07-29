import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import {
  FileLeaseLock,
  FileLeaseLockError,
} from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];
const children: ChildProcess[] = [];

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
    const fixture = createFixture();
    const readyPath = join(fixture.root, 'ready');
    const child = fork(
      resolve('tests/fixtures/hold-file-lease-lock.ts'),
      [fixture.lockPath, readyPath],
      {
        execArgv: ['--import', 'tsx'],
        silent: true,
      },
    );
    children.push(child);
    await waitForFile(readyPath);

    const futureClock: Clock = { now: () => new Date('2099-01-01T00:00:00.000Z') };
    expect(() =>
      new FileLeaseLock(fixture.lockPath, {
        staleAfterMs: 1,
        clock: futureClock,
      }).acquire(),
    ).toThrow(`Lock is owned by pid ${child.pid}`);

    child.send('release');
    await waitForExit(child);
    expect(existsSync(fixture.lockPath)).toBe(false);
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

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
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
