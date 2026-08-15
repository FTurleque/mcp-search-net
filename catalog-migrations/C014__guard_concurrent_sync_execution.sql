-- Reconcile legacy overlapping execution runs before enforcing the new scope invariant.
-- A global execution run (source_id IS NULL) conflicts with every scoped execution run.
-- Without a global run, only the newest execution run for each source is retained.
WITH active_global AS (
  SELECT id
  FROM sync_runs
  WHERE run_kind = 'EXECUTION'
    AND status = 'RUNNING'
    AND completed_at IS NULL
    AND source_id IS NULL
  ORDER BY started_at DESC, id DESC
  LIMIT 1
),
losers AS (
  SELECT candidate.id
  FROM sync_runs AS candidate
  WHERE candidate.run_kind = 'EXECUTION'
    AND candidate.status = 'RUNNING'
    AND candidate.completed_at IS NULL
    AND (
      (
        EXISTS (SELECT 1 FROM active_global)
        AND candidate.id <> (SELECT id FROM active_global)
      )
      OR (
        NOT EXISTS (SELECT 1 FROM active_global)
        AND candidate.source_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM sync_runs AS newer
          WHERE newer.run_kind = 'EXECUTION'
            AND newer.status = 'RUNNING'
            AND newer.completed_at IS NULL
            AND newer.source_id = candidate.source_id
            AND (
              newer.started_at > candidate.started_at
              OR (newer.started_at = candidate.started_at AND newer.id > candidate.id)
            )
        )
      )
    )
)
UPDATE sync_runs
SET completed_at = coalesce(heartbeat_at, started_at),
    status = 'FAILED',
    error_summary = 'Synchronization fenced during C014 migration because another execution run owns the same scope',
    heartbeat_at = coalesce(heartbeat_at, started_at),
    owner_token = NULL,
    owner_pid = NULL,
    owner_hostname = NULL
WHERE id IN (SELECT id FROM losers);

CREATE INDEX ix_sync_runs_running_execution_scope
  ON sync_runs(source_id, started_at DESC, id DESC)
  WHERE run_kind = 'EXECUTION'
    AND status = 'RUNNING'
    AND completed_at IS NULL;

CREATE TRIGGER tr_sync_runs_guard_execution_scope_insert
BEFORE INSERT ON sync_runs
WHEN NEW.run_kind = 'EXECUTION'
  AND NEW.status = 'RUNNING'
  AND NEW.completed_at IS NULL
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM sync_runs AS active
      WHERE active.run_kind = 'EXECUTION'
        AND active.status = 'RUNNING'
        AND active.completed_at IS NULL
        AND (
          NEW.source_id IS NULL
          OR active.source_id IS NULL
          OR active.source_id = NEW.source_id
        )
    )
    THEN RAISE(ABORT, 'CATALOG_SYNC_RUN_ALREADY_RUNNING')
  END;
END;

CREATE TRIGGER tr_sync_runs_guard_execution_scope_update
BEFORE UPDATE OF source_id, run_kind, status, completed_at ON sync_runs
WHEN NEW.run_kind = 'EXECUTION'
  AND NEW.status = 'RUNNING'
  AND NEW.completed_at IS NULL
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM sync_runs AS active
      WHERE active.id <> OLD.id
        AND active.run_kind = 'EXECUTION'
        AND active.status = 'RUNNING'
        AND active.completed_at IS NULL
        AND (
          NEW.source_id IS NULL
          OR active.source_id IS NULL
          OR active.source_id = NEW.source_id
        )
    )
    THEN RAISE(ABORT, 'CATALOG_SYNC_RUN_ALREADY_RUNNING')
  END;
END;
