import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type { CacheRecord, CacheRepository } from '../../application/ports/cache-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import { migrations } from './migrations.js';

interface CacheRow {
  readonly payload: string;
  readonly created_at: number;
  readonly expires_at: number;
}

export class SqliteCacheRepository implements CacheRepository {
  private readonly database: Database.Database;
  private readonly selectStatement: Database.Statement<[string, string], CacheRow>;
  private readonly touchStatement: Database.Statement<[number, string, string]>;
  private readonly deleteStatement: Database.Statement<[string, string]>;
  private readonly upsertStatement: Database.Statement<
    [string, string, string, number, number, number, number]
  >;

  public constructor(
    path: string,
    private readonly clock: Clock,
    private readonly maxEntries: number,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('busy_timeout = 5000');
    this.applyMigrations();

    this.selectStatement = this.database.prepare(
      'SELECT payload, created_at, expires_at FROM cache_entries WHERE namespace = ? AND cache_key = ?',
    );
    this.touchStatement = this.database.prepare(
      'UPDATE cache_entries SET last_accessed_at = ? WHERE namespace = ? AND cache_key = ?',
    );
    this.deleteStatement = this.database.prepare(
      'DELETE FROM cache_entries WHERE namespace = ? AND cache_key = ?',
    );
    this.upsertStatement = this.database.prepare(`
      INSERT INTO cache_entries (
        namespace, cache_key, payload, created_at, expires_at, last_accessed_at, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, cache_key) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        last_accessed_at = excluded.last_accessed_at,
        size_bytes = excluded.size_bytes
    `);
  }

  public get<T>(namespace: string, key: string): Promise<CacheRecord<T> | undefined> {
    const row = this.selectStatement.get(namespace, key);
    if (row === undefined) return Promise.resolve(undefined);

    const now = this.clock.now().getTime();
    if (row.expires_at <= now) {
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
    });
  }

  public set<T>(namespace: string, key: string, value: T, ttlMs: number): Promise<void> {
    const payload = JSON.stringify(value);
    const now = this.clock.now().getTime();
    const transaction = this.database.transaction(() => {
      this.upsertStatement.run(
        namespace,
        key,
        payload,
        now,
        now + ttlMs,
        now,
        Buffer.byteLength(payload),
      );
      this.pruneSync(now);
    });
    transaction();
    return Promise.resolve();
  }

  public delete(namespace: string, key: string): Promise<void> {
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
    const migrate = this.database.transaction(() => {
      for (const migration of migrations) {
        if (hasMigration.get(migration.version) !== undefined) continue;
        this.database.exec(migration.sql);
        recordMigration.run(migration.version, this.clock.now().getTime());
      }
    });
    migrate();
  }

  private pruneSync(now: number): number {
    const expired = this.database
      .prepare('DELETE FROM cache_entries WHERE expires_at <= ?')
      .run(now);
    const overflow = this.database
      .prepare(
        `DELETE FROM cache_entries WHERE rowid IN (
          SELECT rowid FROM cache_entries
          ORDER BY last_accessed_at DESC
          LIMIT -1 OFFSET ?
        )`,
      )
      .run(this.maxEntries);
    return expired.changes + overflow.changes;
  }
}
