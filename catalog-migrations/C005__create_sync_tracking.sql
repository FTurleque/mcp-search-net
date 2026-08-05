CREATE TABLE document_aliases (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  url TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('OLD_URL', 'REDIRECT', 'CANONICAL')),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (document_id, url)
) STRICT;

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES catalog_sources(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED')),
  documents_checked INTEGER NOT NULL,
  documents_added INTEGER NOT NULL,
  documents_updated INTEGER NOT NULL,
  documents_unchanged INTEGER NOT NULL,
  documents_failed INTEGER NOT NULL,
  error_summary TEXT
) STRICT;

CREATE TABLE staleness_events (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  sync_run_id INTEGER REFERENCES sync_runs(id),
  event_type TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  details_json TEXT NOT NULL
) STRICT;

CREATE INDEX ix_document_aliases_document_id ON document_aliases(document_id);
CREATE INDEX ix_sync_runs_source_id ON sync_runs(source_id);
CREATE INDEX ix_staleness_events_document_id ON staleness_events(document_id);
