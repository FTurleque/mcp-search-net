export interface RecoverableWorker {
  readonly failed: boolean;
  reserve(): boolean;
  terminate(): void;
}

export interface RecoveringWorkerPoolOptions {
  readonly size: number;
  readonly retryDelayMs: number;
  readonly pollIntervalMs: number;
  readonly now?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface WorkerSlot<T extends RecoverableWorker> {
  worker: T | undefined;
  repair: Promise<void> | undefined;
  retryAt: number;
}

export class RecoveringWorkerPool<T extends RecoverableWorker> {
  private readonly slots: WorkerSlot<T>[];
  private readonly now: () => number;
  private readonly delay: (milliseconds: number) => Promise<void>;

  public constructor(
    private readonly factory: () => Promise<T>,
    private readonly options: RecoveringWorkerPoolOptions,
  ) {
    if (!Number.isSafeInteger(options.size) || options.size < 1) {
      throw new RangeError('Worker pool size must be a positive integer');
    }
    if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0) {
      throw new RangeError('Worker pool retry delay must be non-negative');
    }
    if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
      throw new RangeError('Worker pool poll interval must be positive');
    }
    this.now = options.now ?? (() => performance.now());
    this.delay = options.delay ?? wait;
    this.slots = Array.from({ length: options.size }, () => ({
      worker: undefined,
      repair: undefined,
      retryAt: 0,
    }));
  }

  public async initialize(): Promise<void> {
    await Promise.all(
      this.slots.map(async (slot) => {
        const worker = await this.factory();
        if (worker.failed) {
          worker.terminate();
          throw new Error('Worker factory returned a failed worker');
        }
        slot.worker = worker;
      }),
    );
  }

  public async reserve(deadline: number, timeoutError: () => Error): Promise<T> {
    for (;;) {
      for (const slot of this.slots) {
        const worker = slot.worker;
        if (worker?.failed === true) {
          slot.worker = undefined;
          worker.terminate();
          this.scheduleRepair(slot);
          continue;
        }
        if (worker?.reserve() === true) return worker;
        if (worker === undefined) this.scheduleRepair(slot);
      }

      const remaining = Math.ceil(deadline - this.now());
      if (remaining <= 0) throw timeoutError();
      await this.delay(Math.min(this.options.pollIntervalMs, remaining));
    }
  }

  public reportFailure(worker: T): void {
    const slot = this.slots.find((candidate) => candidate.worker === worker);
    if (slot === undefined || !worker.failed) return;
    slot.worker = undefined;
    worker.terminate();
    this.scheduleRepair(slot);
  }

  private scheduleRepair(slot: WorkerSlot<T>): void {
    if (slot.worker !== undefined || slot.repair !== undefined || this.now() < slot.retryAt) return;

    slot.repair = this.factory()
      .then((replacement) => {
        if (replacement.failed) {
          replacement.terminate();
          throw new Error('Worker factory returned a failed worker');
        }
        slot.worker = replacement;
        slot.retryAt = 0;
      })
      .catch(() => {
        slot.retryAt = this.now() + this.options.retryDelayMs;
      })
      .finally(() => {
        slot.repair = undefined;
      });
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}
