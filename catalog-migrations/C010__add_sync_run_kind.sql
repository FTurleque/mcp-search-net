ALTER TABLE sync_runs
ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'EXECUTION'
CHECK (run_kind IN ('EXECUTION', 'PLAN'));

CREATE INDEX ix_sync_runs_run_kind_started_at
ON sync_runs(run_kind, started_at DESC, id DESC);
