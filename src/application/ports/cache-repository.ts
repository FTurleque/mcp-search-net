export interface CacheValidators {
  readonly etag?: string;
  readonly lastModified?: string;
  readonly contentHash?: string;
  /** Exact transport URL whose representation emitted the HTTP validators. */
  readonly validatorUrl?: string;
}

export interface CacheRecord<T> extends CacheValidators {
  readonly value: T;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly stale: boolean;
}

export interface CacheGetOptions<T = unknown> {
  readonly allowStale?: boolean;
  readonly decode?: (value: unknown) => T | undefined;
}

export interface CacheRepository {
  getSearch<T>(key: string, options?: CacheGetOptions<T>): Promise<CacheRecord<T> | undefined>;
  setSearch<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<boolean>;
  getContent<T>(key: string, options?: CacheGetOptions<T>): Promise<CacheRecord<T> | undefined>;
  setContent<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<boolean>;
  deleteExpired(): Promise<number>;
  close(): void;
}

export class DisabledCacheRepository implements CacheRepository {
  public getSearch<T>(): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }
  public setSearch(): Promise<boolean> {
    return Promise.resolve(false);
  }
  public getContent<T>(): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }
  public setContent(): Promise<boolean> {
    return Promise.resolve(false);
  }
  public deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
  public close(): void {
    // No resources are allocated when caching is disabled.
  }
}
