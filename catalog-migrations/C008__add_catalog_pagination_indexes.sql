CREATE INDEX ix_documents_language_id ON documents(language, id);
CREATE INDEX ix_documents_source_language_status_id
  ON documents(source_id, language, status, id);
