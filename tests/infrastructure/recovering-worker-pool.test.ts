import { describe, expect, it } from 'vitest';

import { RecoveringWorkerPool } from '../../src/infrastructure/fetch/recovering-worker-pool.js';

class FakeWorker {
  private reserved = false;
  public terminated = 0;

  public constructor(public failed = false) {}

  public reserve(): boolean {
    if (this.failed || this.reserved) return false;
    this.reserved = true;
    return true;
  }

  public fail(): void {
    this.failed = true;
    this.reserved = false;
  }

  public terminate(): void {
    this.terminated += 1;
    this.failed = true;
    this.reserved = false;
  }
}

describe('RecoveringWorkerPool', () => {
  it('validates fixed-pool timing and size invariants', () => {
    const factory = async () => new FakeWorker();

    expect(
      () =>
        new RecoveringWorkerPool(factory, {
          size: 0,
          retryDelayMs: 1,
          pollIntervalMs: 1,
        }),
    ).toThrow('Worker pool size must be a positive integer');
    expect(
      () =>
        new RecoveringWorkerPool(factory, {
          size: 1,
          retryDelayMs: -1,
          pollIntervalMs: 1,
        }),
    ).toThrow('Worker pool retry delay must be non-negative');
    expect(
      () =>
        new RecoveringWorkerPool(factory, {
          size: 1,
          retryDelayMs: 1,
          pollIntervalMs: 0,
        }),
    ).toThrow('Worker pool poll interval must be positive');
  });

  it('rejects a failed worker returned during initial pool creation', async () => {
    const failedWorker = new FakeWorker(true);
    const pool = new RecoveringWorkerPool(async () => failedWorker, {
      size: 1,
      retryDelayMs: 1,
      pollIntervalMs: 1,
    });

    await expect(pool.initialize()).rejects.toThrow('Worker factory returned a failed worker');
    expect(failedWorker.terminated).toBe(1);
  });

  it('retries a transient failed replacement and restores the fixed pool capacity', async () => {
    let factoryAttempts = 0;
    let now = 0;
    const pool = new RecoveringWorkerPool<FakeWorker>(
      async () => {
        factoryAttempts += 1;
        if (factoryAttempts === 3) return new FakeWorker(true);
        return new FakeWorker();
      },
      {
        size: 2,
        retryDelayMs: 5,
        pollIntervalMs: 1,
        now: () => now,
        delay: async (milliseconds) => {
          now += milliseconds;
          await Promise.resolve();
        },
      },
    );
    await pool.initialize();

    const failedWorker = await pool.reserve(100, () => new Error('deadline exceeded'));
    failedWorker.fail();
    pool.reportFailure(failedWorker);
    await Promise.resolve();
    await Promise.resolve();

    const survivingWorker = await pool.reserve(100, () => new Error('deadline exceeded'));
    const replacementWorker = await pool.reserve(100, () => new Error('deadline exceeded'));

    expect(replacementWorker).not.toBe(survivingWorker);
    expect(factoryAttempts).toBe(4);
  });

  it('repairs a worker that died while idle before the next reservation', async () => {
    let factoryAttempts = 0;
    let now = 0;
    const initialWorker = new FakeWorker();
    const replacementWorker = new FakeWorker();
    const pool = new RecoveringWorkerPool<FakeWorker>(
      async () => {
        factoryAttempts += 1;
        return factoryAttempts === 1 ? initialWorker : replacementWorker;
      },
      {
        size: 1,
        retryDelayMs: 1,
        pollIntervalMs: 1,
        now: () => now,
        delay: async (milliseconds) => {
          now += milliseconds;
          await Promise.resolve();
        },
      },
    );
    await pool.initialize();
    initialWorker.fail();

    const reserved = await pool.reserve(100, () => new Error('deadline exceeded'));

    expect(reserved).toBe(replacementWorker);
    expect(initialWorker.terminated).toBe(1);
    expect(factoryAttempts).toBe(2);
  });

  it('ignores failure reports for healthy or unowned workers', async () => {
    const ownedWorker = new FakeWorker();
    const pool = new RecoveringWorkerPool(async () => ownedWorker, {
      size: 1,
      retryDelayMs: 1,
      pollIntervalMs: 1,
    });
    await pool.initialize();
    const unownedWorker = new FakeWorker(true);

    pool.reportFailure(unownedWorker);
    pool.reportFailure(ownedWorker);

    expect(unownedWorker.terminated).toBe(0);
    expect(ownedWorker.terminated).toBe(0);
    expect(await pool.reserve(performance.now() + 100, () => new Error('deadline exceeded'))).toBe(
      ownedWorker,
    );
  });

  it('never creates overflow workers while all fixed slots are merely busy', async () => {
    let factoryAttempts = 0;
    let now = 0;
    const pool = new RecoveringWorkerPool<FakeWorker>(
      async () => {
        factoryAttempts += 1;
        return new FakeWorker();
      },
      {
        size: 2,
        retryDelayMs: 5,
        pollIntervalMs: 1,
        now: () => now,
        delay: async (milliseconds) => {
          now += milliseconds;
          await Promise.resolve();
        },
      },
    );
    await pool.initialize();

    await pool.reserve(100, () => new Error('deadline exceeded'));
    await pool.reserve(100, () => new Error('deadline exceeded'));

    await expect(pool.reserve(3, () => new Error('deadline exceeded'))).rejects.toThrow(
      'deadline exceeded',
    );
    expect(factoryAttempts).toBe(2);
  });
});
