ALTER TABLE document_versions
ADD COLUMN pending_current INTEGER NOT NULL DEFAULT 0
CHECK (pending_current IN (0, 1));

CREATE INDEX ix_document_versions_pending_current
ON document_versions(document_id, pending_current)
WHERE pending_current = 1;
