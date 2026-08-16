export interface PdfWorkerPoolClient {
  readonly failed: boolean;
  reserve(): boolean;
  terminate(): void;
}

export type PdfWorkerPoolFactory<T extends PdfWorkerPoolClient> = () => Promise<T>;

export interface PdfWorkerPoolOptions {
  readonly repairRetryMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

interface PdfWorkerPoolSlot<T extends PdfWorkerPoolClient> {
  client: T;
  replacement: Promise<void> | undefined;
  retryAt: number;
}

const DEFAULT_REPAIR_RETRY_MS = 100;
const DEFAULT_POLL_INTERVAL_MS = 10;

export class PdfWorkerPool<T extends PdfWorkerPoolClient> {
  private readonly repairRetryMs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  private constructor(
    private readonly slots: PdfWorkerPoolSlot<T>[],
    private readonly factory: PdfWorkerPoolFactory<T>,
    options: PdfWorkerPoolOptions,
  ) {
    this.repairRetryMs = options.repairRetryMs ?? DEFAULT_REPAIR_RETRY_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? (() => performance.now());
    this.wait = options.wait ?? waitForPdfWorker;

    if (!Number.isSafeInteger(this.repairRetryMs) || this.repairRetryMs < 0) {
      throw new RangeError('repairRetryMs must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0) {
      throw new RangeError('pollIntervalMs must be a positive safe integer');
    }
  }

  public static async create<T extends PdfWorkerPoolClient>(
    size: number,
    factory: PdfWorkerPoolFactory<T>,
    options: PdfWorkerPoolOptions = {},
  ): Promise<PdfWorkerPool<T>> {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new RangeError('PDF worker pool size must be a positive safe integer');
    }

    const clients = await Promise.all(Array.from({ length: size }, () => factory()));
    return new PdfWorkerPool(
      clients.map((client) => ({ client, replacement: undefined, retryAt: 0 })),
      factory,
      options,
    );
  }

  public async reserve(deadline: number, timeoutError: () => Error): Promise<T> {
    for (;;) {
      const now = this.now();
      this.scheduleRepairs(now);

      for (const slot of this.slots) {
        if (slot.client.reserve()) return slot.client;
      }

      const remaining = Math.ceil(deadline - now);
      if (remaining <= 0) throw timeoutError();
      await this.wait(Math.min(this.pollIntervalMs, remaining));
    }
  }

  public repair(client: T): Promise<void> {
    const index = this.slots.findIndex((slot) => slot.client === client);
    if (index === -1 || !client.failed) return Promise.resolve();
    return this.scheduleRepair(index, this.now());
  }

  private scheduleRepairs(now: number): void {
    this.slots.forEach((slot, index) => {
      if (slot.client.failed && slot.replacement === undefined && slot.retryAt <= now) {
        void this.scheduleRepair(index, now);
      }
    });
  }

  private scheduleRepair(index: number, now: number): Promise<void> {
    const slot = this.slots[index];
    if (
      slot === undefined ||
      !slot.client.failed ||
      slot.replacement !== undefined ||
      slot.retryAt > now
    ) {
      return Promise.resolve();
    }

    const failedClient = slot.client;
    const replacementAttempt = this.factory()
      .then((replacement) => {
        if (slot.client === failedClient && failedClient.failed) {
          slot.client = replacement;
          slot.retryAt = 0;
          return;
        }
        replacement.terminate();
      })
      .catch(() => {
        if (slot.client === failedClient && failedClient.failed) {
          slot.retryAt = this.now() + this.repairRetryMs;
        }
      })
      .finally(() => {
        if (slot.replacement === replacementAttempt) slot.replacement = undefined;
      });

    slot.replacement = replacementAttempt;
    return replacementAttempt;
  }
}

async function waitForPdfWorker(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}
