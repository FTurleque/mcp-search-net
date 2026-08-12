ALTER TABLE search_cache ADD COLUMN validator_url TEXT;
ALTER TABLE content_cache ADD COLUMN validator_url TEXT;

-- Cached content created before validator_url existed cannot prove which response URI emitted its
-- validators and may also contain redirect metadata produced by the older mixed-chain semantics.
-- Content cache is disposable, so invalidate every legacy row once instead of attempting an unsafe
-- validator ownership backfill.
DELETE FROM content_cache WHERE 1 = 1;

CREATE TABLE cache_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0)
) STRICT;

INSERT INTO cache_usage(id, entry_count, total_bytes)
SELECT
  1,
  count(*),
  coalesce(sum(size_bytes), 0)
FROM (
  SELECT size_bytes FROM search_cache
  UNION ALL
  SELECT size_bytes FROM content_cache
);

CREATE TRIGGER IF NOT EXISTS search_cache_usage_insert
AFTER INSERT ON search_cache
BEGIN
  UPDATE cache_usage
  SET entry_count = entry_count + 1,
      total_bytes = total_bytes + NEW.size_bytes
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_cache_usage_delete
AFTER DELETE ON search_cache
BEGIN
  UPDATE cache_usage
  SET entry_count = entry_count - 1,
      total_bytes = total_bytes - OLD.size_bytes
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_cache_usage_update
AFTER UPDATE OF size_bytes ON search_cache
WHEN NEW.size_bytes <> OLD.size_bytes
BEGIN
  UPDATE cache_usage
  SET total_bytes = total_bytes + NEW.size_bytes - OLD.size_bytes
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS content_cache_usage_insert
AFTER INSERT ON content_cache
BEGIN
  UPDATE cache_usage
  SET entry_count = entry_count + 1,
      total_bytes = total_bytes + NEW.size_bytes
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS content_cache_usage_delete
AFTER DELETE ON content_cache
BEGIN
  UPDATE cache_usage
  SET entry_count = entry_count - 1,
      total_bytes = total_bytes - OLD.size_bytes
  WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS content_cache_usage_update
AFTER UPDATE OF size_bytes ON content_cache
WHEN NEW.size_bytes <> OLD.size_bytes
BEGIN
  UPDATE cache_usage
  SET total_bytes = total_bytes + NEW.size_bytes - OLD.size_bytes
  WHERE id = 1;
END;
