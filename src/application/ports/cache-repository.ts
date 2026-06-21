export type CacheNamespace = 'search' | 'content' | 'temporary-error';

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
  get<T>(
    namespace: CacheNamespace,
    key: string,
    options?: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined>;
  set<T>(
    namespace: CacheNamespace,
    key: string,
    value: T,
    ttlMs: number,
    validators?: CacheValidators,
  ): Promise<void>;
  delete(namespace: CacheNamespace, key: string): Promise<void>;
  prune(): Promise<number>;
  close(): void;
}

export class DisabledCacheRepository implements CacheRepository {
  public readonly enabled = false;
  public get<T>(): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }
  public set(): Promise<void> {
    return Promise.resolve();
  }
  public delete(): Promise<void> {
    return Promise.resolve();
  }
  public prune(): Promise<number> {
    return Promise.resolve(0);
  }
  public close(): void {
    // No resources are allocated when caching is disabled.
  }
}
