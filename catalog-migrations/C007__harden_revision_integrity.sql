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
  content = '',
  contentless_delete = 1,
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

CREATE TRIGGER documents_current_version_insert_guard
BEFORE INSERT ON documents
WHEN NEW.current_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM document_versions
   WHERE document_versions.id = NEW.current_version_id
     AND document_versions.document_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CURRENT_VERSION_INVALID');
END;

CREATE TRIGGER documents_current_version_update_guard
BEFORE UPDATE OF current_version_id ON documents
WHEN NEW.current_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM document_versions
   WHERE document_versions.id = NEW.current_version_id
     AND document_versions.document_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CURRENT_VERSION_INVALID');
END;

CREATE TRIGGER document_versions_current_pointer_delete_guard
BEFORE DELETE ON document_versions
WHEN EXISTS (
  SELECT 1
  FROM documents
  WHERE documents.current_version_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CURRENT_VERSION_DELETE_BLOCKED');
END;

CREATE TRIGGER document_versions_current_pointer_update_guard
BEFORE UPDATE OF id, document_id ON document_versions
WHEN EXISTS (
  SELECT 1
  FROM documents
  WHERE documents.current_version_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'DOCUMENT_CURRENT_VERSION_UPDATE_BLOCKED');
END;
