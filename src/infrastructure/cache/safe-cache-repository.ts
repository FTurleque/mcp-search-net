import type {
  CacheGetOptions,
  CacheNamespace,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../application/ports/cache-repository.js';
import { CacheUnavailableError } from '../../domain/errors/domain-errors.js';
import type { StructuredLogger } from '../logging/structured-logger.js';

export class SafeCacheRepository implements CacheRepository {
  private available = true;

  public constructor(
    private readonly inner: CacheRepository,
    private readonly continueOnError: boolean,
    private readonly logger: StructuredLogger,
  ) {}

  public get enabled(): boolean {
    return this.available && this.inner.enabled !== false;
  }

  public async get<T>(
    namespace: CacheNamespace,
    key: string,
    options?: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined> {
    return this.run('get', () => this.inner.get<T>(namespace, key, options), undefined);
  }

  public async set<T>(
    namespace: CacheNamespace,
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<void> {
    await this.run(
      'set',
      () => this.inner.set(namespace, key, value, ttlMs, validators),
      undefined,
    );
  }

  public async delete(namespace: CacheNamespace, key: string): Promise<void> {
    await this.run('delete', () => this.inner.delete(namespace, key), undefined);
  }

  public async prune(): Promise<number> {
    return this.run('prune', () => this.inner.prune(), 0);
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
