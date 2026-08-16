DROP TABLE document_section_fts;

CREATE VIRTUAL TABLE document_section_fts USING fts5(
  section_id UNINDEXED,
  document_id UNINDEXED,
  source_key UNINDEXED,
  language UNINDEXED,
  title,
  heading,
  heading_path,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);

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
