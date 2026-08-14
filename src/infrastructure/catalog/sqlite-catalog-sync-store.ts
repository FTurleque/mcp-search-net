import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import type Database from 'better-sqlite3';

import type { CatalogSyncRunProgress } from '../../application/ports/catalog-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogDocumentObservationInput,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunKind,
  CatalogSyncRunStartRequest,
  CatalogSyncRunStatus,
} from '../../domain/models/catalog.js';
import type { CatalogSyncRunRow } from './catalog-row-mappers.js';
import { toCatalogSyncRun } from './catalog-row-mappers.js';

const DEFAULT_ABANDONED_RUN_AFTER_MS = 120_000;

const INSERT_CATALOG_SYNC_RUN_SQL = `
  INSERT INTO sync_runs (
    source_id, run_kind, started_at, completed_at, status,
    documents_checked, documents_added, documents_updated, documents_unchanged,
    documents_failed, error_summary, owner_token, owner_pid, owner_hostname, heartbeat_at
  ) VALUES (?, ?, ?, NULL, 'RUNNING', 0, 0, 0, 0, 0, NULL, ?, ?, ?, ?)
`;

const SELECT_CATALOG_SYNC_RUN_BY_ID_SQL = 'SELECT * FROM sync_runs WHERE id = ?';

const UPDATE_CATALOG_SYNC_RUN_PROGRESS_SQL = `
  UPDATE sync_runs SET
    heartbeat_at = ?,
    documents_checked = ?,
    documents_added = ?,
    documents_updated = ?,
    documents_unchanged = ?,
    documents_failed = ?
  WHERE id = ?
    AND status = 'RUNNING'
    AND completed_at IS NULL
    AND owner_token = ?
`;

const COMPLETE_CATALOG_SYNC_RUN_SQL = `
  UPDATE sync_runs SET
    completed_at = ?,
    status = ?,
    documents_checked = ?,
    documents_added = ?,
    documents_updated = ?,
    documents_unchanged = ?,
    documents_failed = ?,
    error_summary = ?,
    heartbeat_at = ?,
    owner_token = NULL,
    owner_pid = NULL,
    owner_hostname = NULL
  WHERE id = ?
    AND status = 'RUNNING'
    AND completed_at IS NULL
    AND owner_token = ?
`;

const SELECT_RUNNING_SYNC_RUN_LEASES_SQL = `
  SELECT id, started_at, heartbeat_at, owner_token, owner_pid, owner_hostname
  FROM sync_runs
  WHERE status = 'RUNNING' AND completed_at IS NULL
`;

const RECOVER_ABANDONED_SYNC_RUN_SQL = `
  UPDATE sync_runs SET
    completed_at = ?,
    status = 'FAILED',
    error_summary = ?,
    heartbeat_at = ?,
    owner_token = NULL,
    owner_pid = NULL,
    owner_hostname = NULL
  WHERE id = ?
    AND status = 'RUNNING'
    AND completed_at IS NULL
    AND owner_token IS ?
`;

const UPSERT_DOCUMENT_ALIAS_SQL = `
  INSERT INTO document_aliases (
    document_id, url, alias_type, first_seen_at, last_seen_at
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(document_id, url) DO UPDATE SET
    alias_type = excluded.alias_type,
    last_seen_at = excluded.last_seen_at
`;

const INSERT_STALENESS_EVENT_SQL = `
  INSERT INTO staleness_events (
    document_id, sync_run_id, event_type, observed_at, details_json
  ) VALUES (?, ?, ?, ?, ?)
`;

const REFRESH_CURRENT_VERSION_VALIDATORS_SQL = `
  UPDATE document_versions
  SET etag = coalesce(?, etag),
      last_modified = coalesce(?, last_modified),
      fetched_at = ?
  WHERE id = (SELECT current_version_id FROM documents WHERE id = ?)
`;

type InsertCatalogSyncRunParams = [
  number | null,
  CatalogSyncRunKind,
  number,
  string,
  number,
  string,
  number,
];
type UpdateCatalogSyncRunProgressParams = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
];
type CompleteCatalogSyncRunParams = [
  number,
  CatalogSyncRunStatus,
  number,
  number,
  number,
  number,
  number,
  string | null,
  number,
  number,
  string,
];
type RecoverAbandonedSyncRunParams = [number, string, number, number, string | null];

type OwnedCatalogSyncRunRow = CatalogSyncRunRow & {
  readonly owner_token: string | null;
};

interface RunningSyncRunLeaseRow {
  readonly id: number;
  readonly started_at: number;
  readonly heartbeat_at: number | null;
  readonly owner_token: string | null;
  readonly owner_pid: number | null;
  readonly owner_hostname: string | null;
}

export interface CatalogSyncRunLeaseOptions {
  readonly pid?: number;
  readonly hostname?: string;
  readonly ownerTokenFactory?: () => string;
  readonly processAlive?: (pid: number) => boolean;
  readonly abandonedAfterMs?: number;
}

export class SqliteCatalogSyncStore {
  private readonly pid: number;
  private readonly hostname: string;
  private readonly ownerTokenFactory: () => string;
  private readonly processAlive: (pid: number) => boolean;
  private readonly abandonedAfterMs: number;
  private readonly ownedRuns = new Map<number, string>();

  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
    options: CatalogSyncRunLeaseOptions = {},
  ) {
    this.pid = options.pid ?? process.pid;
    this.hostname = options.hostname ?? hostname();
    this.ownerTokenFactory = options.ownerTokenFactory ?? randomUUID;
    this.processAlive = options.processAlive ?? isProcessAlive;
    this.abandonedAfterMs = options.abandonedAfterMs ?? DEFAULT_ABANDONED_RUN_AFTER_MS;
    if (!Number.isSafeInteger(this.abandonedAfterMs) || this.abandonedAfterMs <= 0) {
      throw new RangeError('abandonedAfterMs must be a positive safe integer');
    }
  }

  public start(input: CatalogSyncRunStartRequest): CatalogSyncRun {
    const ownerToken = this.ownerTokenFactory();
    const startedAt = input.startedAt.getTime();
    const info = this.database
      .prepare<InsertCatalogSyncRunParams>(INSERT_CATALOG_SYNC_RUN_SQL)
      .run(
        input.sourceId ?? null,
        input.runKind ?? 'EXECUTION',
        startedAt,
        ownerToken,
        this.pid,
        this.hostname,
        startedAt,
      );
    const id = Number(info.lastInsertRowid);
    const row = this.database
      .prepare<[number], CatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
      .get(id);
    if (row === undefined) throw new Error('CATALOG_SYNC_RUN_INSERT_FAILED');
    this.ownedRuns.set(id, ownerToken);
    return toCatalogSyncRun(row);
  }

  public updateProgress(syncRunId: number, progress: CatalogSyncRunProgress): void {
    validateProgress(progress);
    const ownerToken = this.requireOwnedRun(syncRunId);
    const result = this.database
      .prepare<UpdateCatalogSyncRunProgressParams>(UPDATE_CATALOG_SYNC_RUN_PROGRESS_SQL)
      .run(
        progress.heartbeatAt.getTime(),
        progress.documentsChecked,
        progress.documentsAdded,
        progress.documentsUpdated,
        progress.documentsUnchanged,
        progress.documentsFailed,
        syncRunId,
        ownerToken,
      );
    if (result.changes !== 1) {
      this.ownedRuns.delete(syncRunId);
      throw new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
    }
  }

  public complete(syncRunId: number, input: CatalogSyncRunCompletionInput): CatalogSyncRun {
    const ownerToken = this.requireOwnedRun(syncRunId);
    const transaction = this.database.transaction((): CatalogSyncRunRow => {
      const running = this.database
        .prepare<[number], OwnedCatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(syncRunId);
      if (running === undefined) throw new Error('CATALOG_SYNC_RUN_NOT_FOUND');
      if (running.status !== 'RUNNING' || running.completed_at !== null) {
        throw new Error('CATALOG_SYNC_RUN_ALREADY_COMPLETED');
      }
      if (running.owner_token !== ownerToken) {
        throw new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
      }
      if (input.completedAt.getTime() < running.started_at) {
        throw new Error('CATALOG_SYNC_RUN_COMPLETION_PRECEDES_START');
      }
      const result = this.database
        .prepare<CompleteCatalogSyncRunParams>(COMPLETE_CATALOG_SYNC_RUN_SQL)
        .run(
          input.completedAt.getTime(),
          input.status,
          input.documentsChecked,
          input.documentsAdded,
          input.documentsUpdated,
          input.documentsUnchanged,
          input.documentsFailed,
          input.errorSummary ?? null,
          input.completedAt.getTime(),
          syncRunId,
          ownerToken,
        );
      if (result.changes !== 1) throw new Error('CATALOG_SYNC_RUN_COMPLETION_FAILED');
      const row = this.database
        .prepare<[number], CatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(syncRunId);
      if (row === undefined) throw new Error('CATALOG_SYNC_RUN_COMPLETION_FAILED');
      return row;
    });
    try {
      return toCatalogSyncRun(transaction());
    } finally {
      this.ownedRuns.delete(syncRunId);
    }
  }

  public recoverAbandonedRuns(): number {
    const now = this.clock.now().getTime();
    const recover = this.database.transaction(() => {
      const rows = this.database
        .prepare<[], RunningSyncRunLeaseRow>(SELECT_RUNNING_SYNC_RUN_LEASES_SQL)
        .all();
      const statement = this.database.prepare<RecoverAbandonedSyncRunParams>(
        RECOVER_ABANDONED_SYNC_RUN_SQL,
      );
      let recovered = 0;
      for (const row of rows) {
        if (!this.isAbandoned(row, now)) continue;
        recovered += statement.run(
          now,
          'Synchronization interrupted: owner lease expired or process is no longer active',
          now,
          row.id,
          row.owner_token,
        ).changes;
      }
      return recovered;
    });
    return recover.immediate();
  }

  public persistObservation(
    documentId: number,
    observation: CatalogDocumentObservationInput | undefined,
    observedAt: number,
  ): void {
    if (observation === undefined) return;

    this.refreshCurrentVersionValidators(documentId, observation, observedAt);

    const aliasStatement =
      this.database.prepare<[number, string, string, number, number]>(UPSERT_DOCUMENT_ALIAS_SQL);
    for (const alias of observation.aliases ?? []) {
      aliasStatement.run(documentId, alias.url, alias.aliasType, observedAt, observedAt);
    }

    const eventStatement = this.database.prepare<[number, number, string, number, string]>(
      INSERT_STALENESS_EVENT_SQL,
    );
    for (const event of observation.events ?? []) {
      assertJsonObject(event.detailsJson);
      eventStatement.run(
        documentId,
        observation.syncRunId,
        event.eventType,
        observedAt,
        event.detailsJson,
      );
    }
  }

  private requireOwnedRun(syncRunId: number): string {
    const ownerToken = this.ownedRuns.get(syncRunId);
    if (ownerToken === undefined) throw new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
    return ownerToken;
  }

  private isAbandoned(row: RunningSyncRunLeaseRow, now: number): boolean {
    const lastHeartbeat = row.heartbeat_at ?? row.started_at;
    if (now - lastHeartbeat > this.abandonedAfterMs) return true;
    if (row.owner_pid === null || row.owner_hostname === null) return false;
    if (row.owner_hostname !== this.hostname) return false;
    return !this.processAlive(row.owner_pid);
  }

  private refreshCurrentVersionValidators(
    documentId: number,
    observation: CatalogDocumentObservationInput,
    observedAt: number,
  ): void {
    const validators = observation.currentVersionValidators;
    if (validators === undefined) return;
    const result = this.database
      .prepare<
        [string | null, string | null, number, number]
      >(REFRESH_CURRENT_VERSION_VALIDATORS_SQL)
      .run(validators.etag ?? null, validators.lastModified ?? null, observedAt, documentId);
    if (result.changes !== 1) throw new Error('CATALOG_CURRENT_VERSION_VALIDATOR_REFRESH_FAILED');
  }
}

function validateProgress(progress: CatalogSyncRunProgress): void {
  if (!Number.isFinite(progress.heartbeatAt.getTime())) {
    throw new Error('CATALOG_SYNC_RUN_HEARTBEAT_INVALID');
  }
  for (const value of [
    progress.documentsChecked,
    progress.documentsAdded,
    progress.documentsUpdated,
    progress.documentsUnchanged,
    progress.documentsFailed,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('CATALOG_SYNC_RUN_PROGRESS_INVALID');
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isSystemError(error, 'ESRCH');
  }
}

function isSystemError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function assertJsonObject(value: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('CATALOG_STALENESS_EVENT_DETAILS_INVALID');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CATALOG_STALENESS_EVENT_DETAILS_INVALID');
  }
}
