export interface Migration {
  readonly version: number;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS cache_entries (
        namespace TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        PRIMARY KEY (namespace, cache_key)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at);
      CREATE INDEX IF NOT EXISTS idx_cache_access ON cache_entries(last_accessed_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE cache_entries ADD COLUMN etag TEXT;
      ALTER TABLE cache_entries ADD COLUMN last_modified TEXT;
      ALTER TABLE cache_entries ADD COLUMN content_hash TEXT;
    `,
  },
];
