DELETE FROM document_section_fts; -- NOSONAR

ALTER TABLE document_sections RENAME TO document_sections_c008;

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
  UNIQUE (document_version_id, ordinal)
) STRICT;

INSERT INTO document_sections(
  id, document_version_id, ordinal, heading, heading_path, heading_level,
  anchor, content, content_hash, character_count, token_count
)
SELECT
  id, document_version_id, ordinal, heading, heading_path, heading_level,
  anchor, content, content_hash, character_count, token_count
FROM document_sections_c008
ORDER BY id; -- NOSONAR

DROP TABLE document_sections_c008;

CREATE INDEX ix_document_sections_version_id ON document_sections(document_version_id);
CREATE INDEX ix_document_sections_ordinal ON document_sections(document_version_id, ordinal);

INSERT INTO document_section_fts(
  rowid, section_id, document_id, source_key, language,
  title, heading, heading_path, content
)
SELECT
  document_sections.id,
  document_sections.id,
  documents.id,
  catalog_sources.source_key,
  documents.language,
  documents.title,
  coalesce(document_sections.heading, ''),
  coalesce(document_sections.heading_path, ''),
  document_sections.content
FROM document_sections
INNER JOIN document_versions
  ON document_versions.id = document_sections.document_version_id
 AND document_versions.is_current = 1
INNER JOIN documents
  ON documents.id = document_versions.document_id
 AND documents.current_version_id = document_versions.id
INNER JOIN catalog_sources
  ON catalog_sources.id = documents.source_id
WHERE catalog_sources.enabled = 1
  AND documents.status = 'ACTIVE';
