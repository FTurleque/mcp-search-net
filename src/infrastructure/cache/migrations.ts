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
  {
    version: 3,
    sql: `
      CREATE TABLE search_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        etag TEXT,
        last_modified TEXT,
        content_hash TEXT
      ) STRICT;

      CREATE TABLE content_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        etag TEXT,
        last_modified TEXT,
        content_hash TEXT
      ) STRICT;

      CREATE TABLE temporary_error_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        etag TEXT,
        last_modified TEXT,
        content_hash TEXT
      ) STRICT;

      INSERT OR IGNORE INTO search_cache
        SELECT cache_key, payload, created_at, expires_at, last_accessed_at, size_bytes,
               etag, last_modified, content_hash
        FROM cache_entries WHERE namespace = 'search';
      INSERT OR IGNORE INTO content_cache
        SELECT cache_key, payload, created_at, expires_at, last_accessed_at, size_bytes,
               etag, last_modified, content_hash
        FROM cache_entries WHERE namespace = 'content';
      INSERT OR IGNORE INTO temporary_error_cache
        SELECT cache_key, payload, created_at, expires_at, last_accessed_at, size_bytes,
               etag, last_modified, content_hash
        FROM cache_entries WHERE namespace = 'temporary-error';

      DROP TABLE cache_entries;

      CREATE INDEX idx_search_cache_expiry ON search_cache(expires_at);
      CREATE INDEX idx_search_cache_access ON search_cache(last_accessed_at);
      CREATE INDEX idx_content_cache_expiry ON content_cache(expires_at);
      CREATE INDEX idx_content_cache_access ON content_cache(last_accessed_at);
      CREATE INDEX idx_temporary_error_cache_expiry ON temporary_error_cache(expires_at);
      CREATE INDEX idx_temporary_error_cache_access ON temporary_error_cache(last_accessed_at);
    `,
  },
];
