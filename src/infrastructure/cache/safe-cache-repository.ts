import type {
  CacheGetOptions,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../application/ports/cache-repository.js';
import { CacheUnavailableError } from '../../domain/errors/domain-errors.js';
import type { Logger } from '../../application/ports/logger.js';

const DEFAULT_RECOVERY_RETRY_MS = 1_000;

export class SafeCacheRepository implements CacheRepository {
  private available = true;
  private unavailableCause: unknown;
  private unavailableSince = 0;

  public constructor(
    private readonly inner: CacheRepository,
    private readonly continueOnError: boolean,
    private readonly logger: Logger,
    private readonly recoveryRetryMs: number = DEFAULT_RECOVERY_RETRY_MS,
  ) {
    if (!Number.isSafeInteger(recoveryRetryMs) || recoveryRetryMs < 0) {
      throw new RangeError('recoveryRetryMs must be a non-negative safe integer');
    }
  }

  public async getSearch<T>(
    key: string,
    options?: CacheGetOptions<T>,
  ): Promise<CacheRecord<T> | undefined> {
    return this.run('getSearch', () => this.inner.getSearch<T>(key, options), undefined);
  }

  public async setSearch<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<boolean> {
    return this.run('setSearch', () => this.inner.setSearch(key, value, ttlMs, validators), false);
  }

  public async getContent<T>(
    key: string,
    options?: CacheGetOptions<T>,
  ): Promise<CacheRecord<T> | undefined> {
    return this.run('getContent', () => this.inner.getContent<T>(key, options), undefined);
  }

  public async setContent<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<boolean> {
    return this.run(
      'setContent',
      () => this.inner.setContent(key, value, ttlMs, validators),
      false,
    );
  }

  public async deleteExpired(): Promise<number> {
    return this.run('deleteExpired', () => this.inner.deleteExpired(), 0);
  }

  public close(): void {
    try {
      this.inner.close();
    } catch {
      /* Shutdown remains best effort. */
    }
  }

  private async run<T>(operation: string, action: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.available && Date.now() - this.unavailableSince < this.recoveryRetryMs) {
      if (this.continueOnError) return fallback;
      throw new CacheUnavailableError('The cache is unavailable', {
        cause: this.unavailableCause,
      });
    }

    try {
      const result = await action();
      if (!this.available) {
        this.available = true;
        this.unavailableCause = undefined;
        this.unavailableSince = 0;
        this.logger.info('cache_recovered', { operation });
      }
      return result;
    } catch (error) {
      this.available = false;
      this.unavailableCause = error;
      this.unavailableSince = Date.now();
      this.logger.error('cache_unavailable', {
        operation,
        error: error instanceof Error ? { name: error.name } : 'unknown',
      });
      if (!this.continueOnError)
        throw new CacheUnavailableError('The cache is unavailable', { cause: error });
      return fallback;
    }
  }
}
