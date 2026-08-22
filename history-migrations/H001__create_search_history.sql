CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  tool TEXT NOT NULL CHECK (tool IN ('search_web', 'search_docs')),
  query TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  executed_at INTEGER NOT NULL,
  duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  cache_status TEXT CHECK (cache_status IN ('HIT', 'MISS', 'STALE_FALLBACK', 'DISABLED')),
  provider TEXT NOT NULL,
  result_count INTEGER CHECK (result_count IS NULL OR result_count >= 0),
  warning_codes_json TEXT NOT NULL CHECK (json_valid(warning_codes_json)),
  error_code TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS ix_search_history_executed_at
  ON search_history(executed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_search_history_tool_executed_at
  ON search_history(tool, executed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_search_history_status_executed_at
  ON search_history(status, executed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_search_history_cache_status_executed_at
  ON search_history(cache_status, executed_at DESC, id DESC);
