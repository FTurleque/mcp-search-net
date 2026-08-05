CREATE TABLE catalog_sources (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('documentation', 'reference', 'api', 'guide')),
  language TEXT NOT NULL,
  freshness_policy TEXT NOT NULL CHECK (freshness_policy IN ('manual', 'daily', 'weekly', 'monthly')),
  sync_strategy TEXT NOT NULL CHECK (sync_strategy IN ('manual', 'polling')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source_key)
) STRICT;

CREATE INDEX ix_catalog_sources_enabled ON catalog_sources(enabled);
