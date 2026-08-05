CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES catalog_sources(id),
  canonical_url TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'STALE', 'REDIRECTED', 'REMOVED', 'UNAVAILABLE')),
  current_version_id INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (public_id),
  UNIQUE (source_id, stable_key),
  UNIQUE (source_id, canonical_url)
) STRICT;

CREATE INDEX ix_documents_source_id ON documents(source_id);
CREATE INDEX ix_documents_status ON documents(status);
