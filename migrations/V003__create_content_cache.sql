CREATE TABLE IF NOT EXISTS content_cache (
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

CREATE INDEX IF NOT EXISTS idx_content_cache_expiry ON content_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_content_cache_access ON content_cache(last_accessed_at);
