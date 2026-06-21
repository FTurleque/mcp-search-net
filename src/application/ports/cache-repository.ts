export interface CacheRecord<T> {
  readonly value: T;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface CacheRepository {
  get<T>(namespace: string, key: string): Promise<CacheRecord<T> | undefined>;
  set<T>(namespace: string, key: string, value: T, ttlMs: number): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  prune(): Promise<number>;
  close(): void;
}
