DROP INDEX IF EXISTS ix_documents_language_id;
DROP INDEX IF EXISTS ix_documents_source_language_status_id;

CREATE INDEX ix_documents_language_id
  ON documents(language COLLATE NOCASE, id);
CREATE INDEX ix_documents_source_language_status_id
  ON documents(source_id, language COLLATE NOCASE, status, id);
