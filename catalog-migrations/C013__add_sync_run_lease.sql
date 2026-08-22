ALTER TABLE sync_runs ADD COLUMN owner_token TEXT;
ALTER TABLE sync_runs ADD COLUMN owner_pid INTEGER CHECK (owner_pid IS NULL OR owner_pid > 0);
ALTER TABLE sync_runs ADD COLUMN owner_hostname TEXT;
ALTER TABLE sync_runs ADD COLUMN heartbeat_at INTEGER;

CREATE INDEX ix_sync_runs_running_heartbeat
  ON sync_runs(status, heartbeat_at)
  WHERE status = 'RUNNING';
