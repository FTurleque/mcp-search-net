CREATE TABLE document_sections (
  id INTEGER PRIMARY KEY,
  document_version_id INTEGER NOT NULL REFERENCES document_versions(id),
  ordinal INTEGER NOT NULL,
  heading TEXT,
  heading_path TEXT,
  heading_level INTEGER,
  anchor TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  token_count INTEGER,
  UNIQUE (document_version_id, ordinal),
  UNIQUE (document_version_id, content_hash)
) STRICT;

CREATE INDEX ix_document_sections_version_id ON document_sections(document_version_id);
CREATE INDEX ix_document_sections_ordinal ON document_sections(document_version_id, ordinal);
