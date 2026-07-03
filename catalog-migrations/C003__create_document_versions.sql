CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  version_label TEXT,
  content_hash TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  extraction_mode TEXT NOT NULL CHECK (extraction_mode IN ('static', 'native-render')),
  content_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE (document_id, content_hash)
) STRICT;

CREATE INDEX ix_document_versions_document_id ON document_versions(document_id);
CREATE INDEX ix_document_versions_current ON document_versions(document_id, is_current);
