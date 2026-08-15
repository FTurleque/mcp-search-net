import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { UrlSecurityPolicy } from '../../src/application/ports/url-security-policy.js';
import { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('2026-08-15 audit follow-up regressions', () => {
  it('transfers a gateway concurrency slot directly to an already queued waiter', async () => {
    const gateway = new SecureHttpGateway(allowingPolicy(), {
      timeoutMs: 1_000,
      maxBytes: 1_024,
      maxRedirects: 0,
      maxConcurrency: 1,
      minimumDelayMs: 0,
      respectRobotsTxt: false,
      userAgent: 'mcp-search-net/audit-test',
    });
    const semaphore = gateway as unknown as GatewaySemaphore;
    const deadline = performance.now() + 1_000;

    await semaphore.acquire(deadline);
    expect(semaphore.active).toBe(1);

    const second = semaphore.acquire(deadline);
    expect(semaphore.waiters).toHaveLength(1);

    semaphore.release();
    const third = semaphore.acquire(deadline);
    await second;

    expect(semaphore.active).toBe(1);
    expect(semaphore.waiters).toHaveLength(1);

    semaphore.release();
    await third;
    expect(semaphore.active).toBe(1);
    expect(semaphore.waiters).toHaveLength(0);

    semaphore.release();
    expect(semaphore.active).toBe(0);
  });

  it('keeps the lease metadata and heartbeat private on POSIX, including after renewal', (context) => {
    if (process.platform === 'win32') context.skip();

    const root = mkdtempSync(join(tmpdir(), 'mcp-file-lease-permissions-'));
    roots.push(root);
    const lockPath = join(root, 'maintenance.lock');
    let now = Date.parse('2026-08-15T00:00:00.000Z');
    const lease = new FileLeaseLock(lockPath, {
      staleAfterMs: 1_000,
      clock: { now: () => new Date(now) },
      ownerTokenFactory: () => 'permission-owner',
    }).acquire();
    const heartbeatPath = `${lockPath}.heartbeat`;

    expect(fileMode(lockPath)).toBe(0o600);
    expect(fileMode(heartbeatPath)).toBe(0o600);

    chmodSync(heartbeatPath, 0o666);
    expect(fileMode(heartbeatPath)).toBe(0o666);
    now += 100;
    lease.renew();

    expect(fileMode(lockPath)).toBe(0o600);
    expect(fileMode(heartbeatPath)).toBe(0o600);
    lease.release();
  });
});

interface GatewaySemaphore {
  active: number;
  readonly waiters: (() => void)[];
  acquire(deadline: number): Promise<void>;
  release(): void;
}

function allowingPolicy(): UrlSecurityPolicy {
  return {
    assertAllowed(value) {
      const url = new URL(value);
      return Promise.resolve({
        value: url.toString(),
        hostname: url.hostname,
        addresses: ['203.0.113.1'],
      });
    },
  };
}

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}
