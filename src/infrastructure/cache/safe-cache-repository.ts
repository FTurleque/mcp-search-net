import type {
  CacheGetOptions,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../application/ports/cache-repository.js';
import { CacheUnavailableError } from '../../domain/errors/domain-errors.js';
import type { Logger } from '../../application/ports/logger.js';

export class SafeCacheRepository implements CacheRepository {
  private available = true;

  public constructor(
    private readonly inner: CacheRepository,
    private readonly continueOnError: boolean,
    private readonly logger: Logger,
  ) {}

  public get enabled(): boolean {
    return this.available && this.inner.enabled !== false;
  }

  public async getSearch<T>(
    key: string,
    options?: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined> {
    return this.run('getSearch', () => this.inner.getSearch<T>(key, options), undefined);
  }

  public async setSearch<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<void> {
    await this.run(
      'setSearch',
      () => this.inner.setSearch(key, value, ttlMs, validators),
      undefined,
    );
  }

  public async getContent<T>(
    key: string,
    options?: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined> {
    return this.run('getContent', () => this.inner.getContent<T>(key, options), undefined);
  }

  public async setContent<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<void> {
    await this.run(
      'setContent',
      () => this.inner.setContent(key, value, ttlMs, validators),
      undefined,
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
    if (!this.available) return fallback;
    try {
      return await action();
    } catch (error) {
      this.available = false;
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
