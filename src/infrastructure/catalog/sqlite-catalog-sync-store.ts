import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogDocumentObservationInput,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunKind,
  CatalogSyncRunStartRequest,
  CatalogSyncRunStatus,
} from '../../domain/models/catalog.js';
import { readProcessIdentity } from '../process-identity.js';
import type { CatalogSyncRunRow } from './catalog-row-mappers.js';
import { toCatalogSyncRun } from './catalog-row-mappers.js';

const DEFAULT_ABANDONED_RUN_AFTER_MS = 3_600_000;
const OWNER_TOKEN_IDENTITY_PREFIX = 'v1.';

const INSERT_CATALOG_SYNC_RUN_SQL = `
  INSERT INTO sync_runs (
    source_id, run_kind, started_at, completed_at, status,
    documents_checked, documents_added, documents_updated, documents_unchanged,
    documents_failed, error_summary, owner_token, owner_pid, owner_hostname, heartbeat_at
  ) VALUES (?, ?, ?, NULL, 'RUNNING', 0, 0, 0, 0, 0, NULL, ?, ?, ?, ?)
`;

const SELECT_CATALOG_SYNC_RUN_BY_ID_SQL = 'SELECT * FROM sync_runs WHERE id = ?';
const SELECT_CATALOG_SYNC_RUN_ID_SQL = 'SELECT id FROM sync_runs WHERE id = ?';

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

const TOUCH_SYNC_RUN_HEARTBEAT_SQL = `
  UPDATE sync_runs
  SET heartbeat_at = ?
  WHERE id = ?
    AND status = 'RUNNING'
    AND completed_at IS NULL
    AND owner_token = ?
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

interface SyncRunIdentityRow {
  readonly id: number;
}

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
  readonly processIdentity?: (pid: number) => string | undefined;
  readonly abandonedAfterMs?: number;
}

export class SqliteCatalogSyncStore {
  private readonly pid: number;
  private readonly hostname: string;
  private readonly ownerTokenFactory: () => string;
  private readonly processAlive: (pid: number) => boolean;
  private readonly processIdentity: (pid: number) => string | undefined;
  private readonly abandonedAfterMs: number;
  private readonly ownedRuns = new Map<number, string>();

  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
    options: CatalogSyncRunLeaseOptions = {},
  ) {
    this.pid = options.pid ?? process.pid;
    this.hostname = options.hostname ?? hostname();
    this.processAlive = options.processAlive ?? isProcessAlive;
    this.processIdentity = options.processIdentity ?? readProcessIdentity;
    const ownerProcessIdentity = this.processIdentity(this.pid);
    this.ownerTokenFactory =
      options.ownerTokenFactory ?? (() => createOwnerToken(randomUUID(), ownerProcessIdentity));
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

  public complete(syncRunId: number, input: CatalogSyncRunCompletionInput): CatalogSyncRun {
    const ownerToken = this.ownedRuns.get(syncRunId);
    const transaction = this.database.transaction((): CatalogSyncRunRow => {
      const running = this.database
        .prepare<[number], OwnedCatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(syncRunId);
      if (running === undefined) throw new Error('CATALOG_SYNC_RUN_NOT_FOUND');
      if (running.status !== 'RUNNING' || running.completed_at !== null) {
        if (ownerToken !== undefined) throw new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
        throw new Error('CATALOG_SYNC_RUN_ALREADY_COMPLETED');
      }
      if (ownerToken === undefined || running.owner_token !== ownerToken) {
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
      const completed = toCatalogSyncRun(transaction.immediate());
      this.ownedRuns.delete(syncRunId);
      return completed;
    } catch (error) {
      this.reconcileCompletionOwnership(syncRunId, ownerToken);
      throw error;
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

    this.renewOwnedRun(observation.syncRunId, observedAt);
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

  private reconcileCompletionOwnership(syncRunId: number, ownerToken: string | undefined): void {
    if (ownerToken === undefined) return;
    try {
      const row = this.database
        .prepare<[number], OwnedCatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(syncRunId);
      if (
        row?.status !== 'RUNNING' ||
        row.completed_at !== null ||
        row.owner_token !== ownerToken
      ) {
        this.ownedRuns.delete(syncRunId);
      }
    } catch {
      // Durable state is unknown. Preserve the local fencing token so the caller can retry.
    }
  }

  private renewOwnedRun(syncRunId: number, observedAt: number): void {
    const ownerToken = this.requireOwnedRunToken(syncRunId);
    const result = this.database
      .prepare<[number, number, string]>(TOUCH_SYNC_RUN_HEARTBEAT_SQL)
      .run(observedAt, syncRunId, ownerToken);
    if (result.changes !== 1) {
      this.ownedRuns.delete(syncRunId);
      throw new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
    }
  }

  private requireOwnedRunToken(syncRunId: number): string {
    const ownerToken = this.ownedRuns.get(syncRunId);
    if (ownerToken !== undefined) return ownerToken;
    const referencedRun = this.database
      .prepare<[number], SyncRunIdentityRow>(SELECT_CATALOG_SYNC_RUN_ID_SQL)
      .get(syncRunId);
    if (referencedRun === undefined) {
      throw new Error('FOREIGN KEY constraint failed: referenced catalog sync run does not exist');
    }
    throw new Error('CATALOG_SYNC_RUN_OWNERSHIP_LOST');
  }

  private isAbandoned(row: RunningSyncRunLeaseRow, now: number): boolean {
    const lastHeartbeat = row.heartbeat_at ?? row.started_at;
    if (row.owner_pid !== null && row.owner_hostname === this.hostname) {
      if (!this.processAlive(row.owner_pid)) return true;
      const recordedIdentity = readOwnerProcessIdentity(row.owner_token);
      if (recordedIdentity !== undefined) {
        const activeIdentity = this.processIdentity(row.owner_pid);
        if (activeIdentity !== undefined && activeIdentity !== recordedIdentity) return true;
      }
      return false;
    }
    return now - lastHeartbeat > this.abandonedAfterMs;
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

function createOwnerToken(entropy: string, processIdentity: string | undefined): string {
  if (processIdentity === undefined) return entropy;
  const encodedIdentity = Buffer.from(processIdentity, 'utf8').toString('base64url');
  return `${OWNER_TOKEN_IDENTITY_PREFIX}${encodedIdentity}.${entropy}`;
}

function readOwnerProcessIdentity(ownerToken: string | null): string | undefined {
  if (!ownerToken?.startsWith(OWNER_TOKEN_IDENTITY_PREFIX)) return undefined;
  const separatorIndex = ownerToken.indexOf('.', OWNER_TOKEN_IDENTITY_PREFIX.length);
  if (separatorIndex === -1) return undefined;
  const encodedIdentity = ownerToken.slice(OWNER_TOKEN_IDENTITY_PREFIX.length, separatorIndex);
  if (!/^[A-Za-z0-9_-]+$/u.test(encodedIdentity)) return undefined;
  const identity = Buffer.from(encodedIdentity, 'base64url').toString('utf8');
  return identity === '' ? undefined : identity;
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
