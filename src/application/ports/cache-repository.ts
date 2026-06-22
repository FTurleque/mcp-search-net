export interface CacheValidators {
  readonly etag?: string;
  readonly lastModified?: string;
  readonly contentHash?: string;
}

export interface CacheRecord<T> extends CacheValidators {
  readonly value: T;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly stale: boolean;
}

export interface CacheGetOptions {
  readonly allowStale?: boolean;
}

export interface CacheRepository {
  readonly enabled?: boolean;
  getSearch<T>(key: string, options?: CacheGetOptions): Promise<CacheRecord<T> | undefined>;
  setSearch<T>(key: string, value: T, ttlMs: number, validators?: CacheValidators): Promise<void>;
  getContent<T>(key: string, options?: CacheGetOptions): Promise<CacheRecord<T> | undefined>;
  setContent<T>(key: string, value: T, ttlMs: number, validators?: CacheValidators): Promise<void>;
  deleteExpired(): Promise<number>;
  close(): void;
}

export class DisabledCacheRepository implements CacheRepository {
  public readonly enabled = false;
  public getSearch<T>(): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }
  public setSearch(): Promise<void> {
    return Promise.resolve();
  }
  public getContent<T>(): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }
  public setContent(): Promise<void> {
    return Promise.resolve();
  }
  public deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
  public close(): void {
    // No resources are allocated when caching is disabled.
  }
}
