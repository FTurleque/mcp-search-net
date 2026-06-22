import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type {
  CacheGetOptions,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../application/ports/cache-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import { loadMigrations } from './migrations.js';

interface CacheRow {
  readonly payload: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly content_hash: string | null;
}

type CacheKind = 'search' | 'content';

const CACHE_TABLES: Readonly<Record<CacheKind, string>> = {
  search: 'search_cache',
  content: 'content_cache',
};

export class SqliteCacheRepository implements CacheRepository {
  public readonly enabled = true;
  private readonly database: Database.Database;
  private readonly selectStatements: Readonly<
    Record<CacheKind, Database.Statement<[string], CacheRow>>
  >;
  private readonly touchStatements: Readonly<
    Record<CacheKind, Database.Statement<[number, string]>>
  >;
  private readonly deleteStatements: Readonly<Record<CacheKind, Database.Statement<[string]>>>;
  private readonly upsertStatements: Readonly<
    Record<
      CacheKind,
      Database.Statement<
        [
          string,
          string,
          number,
          number,
          number,
          number,
          string | null,
          string | null,
          string | null,
        ]
      >
    >
  >;

  public constructor(
    path: string,
    private readonly clock: Clock,
    private readonly maxEntries: number,
    private readonly staleRetentionMs: number,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.applyMigrations();
    this.selectStatements = this.createStatements(
      (table) =>
        `SELECT payload, created_at, expires_at, etag, last_modified, content_hash FROM ${table} WHERE cache_key = ?`,
    );
    this.touchStatements = this.createStatements(
      (table) => `UPDATE ${table} SET last_accessed_at = ? WHERE cache_key = ?`,
    );
    this.deleteStatements = this.createStatements(
      (table) => `DELETE FROM ${table} WHERE cache_key = ?`,
    );
    this.upsertStatements = this.createStatements(
      (table) => `
        INSERT INTO ${table} (
          cache_key, payload, created_at, expires_at, last_accessed_at, size_bytes,
          etag, last_modified, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          payload = excluded.payload,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          last_accessed_at = excluded.last_accessed_at,
          size_bytes = excluded.size_bytes,
          etag = excluded.etag,
          last_modified = excluded.last_modified,
          content_hash = excluded.content_hash
      `,
    );
  }

  public getSearch<T>(
    key: string,
    options: CacheGetOptions = {},
  ): Promise<CacheRecord<T> | undefined> {
    return this.get<T>('search', key, options);
  }

  public getContent<T>(
    key: string,
    options: CacheGetOptions = {},
  ): Promise<CacheRecord<T> | undefined> {
    return this.get<T>('content', key, options);
  }

  public setSearch<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators: CacheValidators = {},
  ): Promise<void> {
    return this.set('search', key, value, ttlMs, validators);
  }

  public setContent<T>(
    key: string,
    value: T,
    ttlMs: number,
    validators: CacheValidators = {},
  ): Promise<void> {
    return this.set('content', key, value, ttlMs, validators);
  }

  public deleteExpired(): Promise<number> {
    return Promise.resolve(this.pruneSync(this.clock.now().getTime()));
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private get<T>(
    kind: CacheKind,
    key: string,
    options: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined> {
    const row = this.selectStatements[kind].get(key);
    if (row === undefined) return Promise.resolve(undefined);
    const now = this.clock.now().getTime();
    const stale = row.expires_at <= now;
    if (stale && options.allowStale !== true) return Promise.resolve(undefined);
    if (row.expires_at + this.staleRetentionMs <= now) {
      this.deleteStatements[kind].run(key);
      return Promise.resolve(undefined);
    }
    let value: T;
    try {
      value = JSON.parse(row.payload) as T;
    } catch {
      this.deleteStatements[kind].run(key);
      return Promise.resolve(undefined);
    }
    this.touchStatements[kind].run(now, key);
    return Promise.resolve({
      value,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      stale,
      ...(row.etag === null ? {} : { etag: row.etag }),
      ...(row.last_modified === null ? {} : { lastModified: row.last_modified }),
      ...(row.content_hash === null ? {} : { contentHash: row.content_hash }),
    });
  }

  private set<T>(
    kind: CacheKind,
    key: string,
    value: T,
    ttlMs: number,
    validators: CacheValidators = {},
  ): Promise<void> {
    const payload = JSON.stringify(value);
    const now = this.clock.now().getTime();
    this.database.transaction(() => {
      this.upsertStatements[kind].run(
        key,
        payload,
        now,
        now + ttlMs,
        now,
        Buffer.byteLength(payload),
        validators.etag ?? null,
        validators.lastModified ?? null,
        validators.contentHash ?? null,
      );
      this.pruneSync(now);
    })();
    return Promise.resolve();
  }

  private applyMigrations(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);
    const hasMigration = this.database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    const recordMigration = this.database.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    );
    this.database.transaction(() => {
      for (const migration of loadMigrations()) {
        if (hasMigration.get(migration.version) !== undefined) continue;
        this.database.exec(migration.sql);
        recordMigration.run(migration.version, this.clock.now().getTime());
      }
    })();
  }

  private createStatements<T extends Database.Statement>(
    sql: (table: string) => string,
  ): Readonly<Record<CacheKind, T>> {
    return Object.fromEntries(
      Object.entries(CACHE_TABLES).map(([namespace, table]) => [
        namespace,
        this.database.prepare(sql(table)),
      ]),
    ) as Readonly<Record<CacheKind, T>>;
  }

  private pruneSync(now: number): number {
    let changes = 0;
    for (const table of Object.values(CACHE_TABLES)) {
      changes += this.database
        .prepare(`DELETE FROM ${table} WHERE expires_at <= ?`)
        .run(now - this.staleRetentionMs).changes;
      changes += this.database
        .prepare(
          `DELETE FROM ${table} WHERE rowid IN (
            SELECT rowid FROM ${table}
            ORDER BY last_accessed_at DESC LIMIT -1 OFFSET ?
          )`,
        )
        .run(this.maxEntries).changes;
    }
    return changes;
  }
}
