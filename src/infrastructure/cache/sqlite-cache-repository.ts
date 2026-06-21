import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type {
  CacheGetOptions,
  CacheNamespace,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../application/ports/cache-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import { migrations } from './migrations.js';

interface CacheRow {
  readonly payload: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly content_hash: string | null;
}

export class SqliteCacheRepository implements CacheRepository {
  public readonly enabled = true;
  private readonly database: Database.Database;
  private readonly selectStatement: Database.Statement<[string, string], CacheRow>;
  private readonly touchStatement: Database.Statement<[number, string, string]>;
  private readonly deleteStatement: Database.Statement<[string, string]>;
  private readonly upsertStatement: Database.Statement<
    [
      string,
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
    this.database.pragma('busy_timeout = 5000');
    this.applyMigrations();
    this.selectStatement = this.database.prepare(
      'SELECT payload, created_at, expires_at, etag, last_modified, content_hash FROM cache_entries WHERE namespace = ? AND cache_key = ?',
    );
    this.touchStatement = this.database.prepare(
      'UPDATE cache_entries SET last_accessed_at = ? WHERE namespace = ? AND cache_key = ?',
    );
    this.deleteStatement = this.database.prepare(
      'DELETE FROM cache_entries WHERE namespace = ? AND cache_key = ?',
    );
    this.upsertStatement = this.database.prepare(`
      INSERT INTO cache_entries (
        namespace, cache_key, payload, created_at, expires_at, last_accessed_at, size_bytes,
        etag, last_modified, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, cache_key) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        last_accessed_at = excluded.last_accessed_at,
        size_bytes = excluded.size_bytes,
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        content_hash = excluded.content_hash
    `);
  }

  public get<T>(
    namespace: CacheNamespace,
    key: string,
    options: CacheGetOptions = {},
  ): Promise<CacheRecord<T> | undefined> {
    const row = this.selectStatement.get(namespace, key);
    if (row === undefined) return Promise.resolve(undefined);
    const now = this.clock.now().getTime();
    const stale = row.expires_at <= now;
    if (stale && options.allowStale !== true) return Promise.resolve(undefined);
    if (row.expires_at + this.staleRetentionMs <= now) {
      this.deleteStatement.run(namespace, key);
      return Promise.resolve(undefined);
    }
    let value: T;
    try {
      value = JSON.parse(row.payload) as T;
    } catch {
      this.deleteStatement.run(namespace, key);
      return Promise.resolve(undefined);
    }
    this.touchStatement.run(now, namespace, key);
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

  public set<T>(
    namespace: CacheNamespace,
    key: string,
    value: T,
    ttlMs: number,
    validators: CacheValidators = {},
  ): Promise<void> {
    const payload = JSON.stringify(value);
    const now = this.clock.now().getTime();
    this.database.transaction(() => {
      this.upsertStatement.run(
        namespace,
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

  public delete(namespace: CacheNamespace, key: string): Promise<void> {
    this.deleteStatement.run(namespace, key);
    return Promise.resolve();
  }

  public prune(): Promise<number> {
    return Promise.resolve(this.pruneSync(this.clock.now().getTime()));
  }

  public close(): void {
    if (this.database.open) this.database.close();
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
      for (const migration of migrations) {
        if (hasMigration.get(migration.version) !== undefined) continue;
        this.database.exec(migration.sql);
        recordMigration.run(migration.version, this.clock.now().getTime());
      }
    })();
  }

  private pruneSync(now: number): number {
    const obsolete = this.database
      .prepare('DELETE FROM cache_entries WHERE expires_at <= ?')
      .run(now - this.staleRetentionMs);
    const overflow = this.database
      .prepare(
        `DELETE FROM cache_entries WHERE rowid IN (
        SELECT rowid FROM cache_entries ORDER BY last_accessed_at DESC LIMIT -1 OFFSET ?
      )`,
      )
      .run(this.maxEntries);
    return obsolete.changes + overflow.changes;
  }
}
