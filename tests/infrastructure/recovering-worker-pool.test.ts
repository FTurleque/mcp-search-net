import { describe, expect, it } from 'vitest';

import { RecoveringWorkerPool } from '../../src/infrastructure/fetch/recovering-worker-pool.js';

class FakeWorker {
  public failed = false;
  private reserved = false;

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
    this.failed = true;
    this.reserved = false;
  }
}

describe('RecoveringWorkerPool', () => {
  it('retries a transient replacement failure and restores the fixed pool capacity', async () => {
    let factoryAttempts = 0;
    let now = 0;
    const pool = new RecoveringWorkerPool<FakeWorker>(
      async () => {
        factoryAttempts += 1;
        if (factoryAttempts === 3) throw new Error('transient worker creation failure');
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
