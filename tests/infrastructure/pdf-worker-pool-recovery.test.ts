import { describe, expect, it } from 'vitest';

import {
  PdfWorkerPool,
  type PdfWorkerPoolClient,
} from '../../src/infrastructure/fetch/pdf-worker-pool.js';

class FakePdfWorker implements PdfWorkerPoolClient {
  public failed = false;
  private reserved = false;

  public reserve(): boolean {
    if (this.failed || this.reserved) return false;
    this.reserved = true;
    return true;
  }

  public terminate(): void {
    this.failed = true;
    this.reserved = false;
  }

  public fail(): void {
    this.failed = true;
    this.reserved = false;
  }
}

describe('PdfWorkerPool recovery', () => {
  it('restores a failed slot after a transient replacement failure', async () => {
    const initial = new FakePdfWorker();
    const recovered = new FakePdfWorker();
    let factoryCalls = 0;
    let now = 0;

    const pool = await PdfWorkerPool.create(
      1,
      async () => {
        factoryCalls += 1;
        if (factoryCalls === 1) return initial;
        if (factoryCalls === 2) throw new Error('transient worker start failure');
        return recovered;
      },
      {
        repairRetryMs: 5,
        pollIntervalMs: 2,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
          await Promise.resolve();
        },
      },
    );

    initial.fail();
    await pool.repair(initial);

    expect(factoryCalls).toBe(2);

    const reserved = await pool.reserve(20, () => new Error('deadline exceeded'));

    expect(reserved).toBe(recovered);
    expect(factoryCalls).toBe(3);
  });

  it('does not start concurrent replacement attempts for the same failed slot', async () => {
    const initial = new FakePdfWorker();
    const replacement = new FakePdfWorker();
    let factoryCalls = 0;
    let resolveReplacement!: (worker: FakePdfWorker) => void;

    const replacementPromise = new Promise<FakePdfWorker>((resolve) => {
      resolveReplacement = resolve;
    });
    const pool = await PdfWorkerPool.create(1, async () => {
      factoryCalls += 1;
      return factoryCalls === 1 ? initial : replacementPromise;
    });

    initial.fail();
    const firstRepair = pool.repair(initial);
    const secondRepair = pool.repair(initial);

    expect(factoryCalls).toBe(2);
    resolveReplacement(replacement);
    await Promise.all([firstRepair, secondRepair]);

    const reserved = await pool.reserve(performance.now() + 100, () => new Error('timeout'));
    expect(reserved).toBe(replacement);
    expect(factoryCalls).toBe(2);
  });
});
