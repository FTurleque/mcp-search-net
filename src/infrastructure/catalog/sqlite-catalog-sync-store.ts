import type Database from 'better-sqlite3';

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

const INSERT_CATALOG_SYNC_RUN_SQL = `
  INSERT INTO sync_runs (
    source_id, run_kind, started_at, completed_at, status,
    documents_checked, documents_added, documents_updated, documents_unchanged,
    documents_failed, error_summary
  ) VALUES (?, ?, ?, NULL, 'RUNNING', 0, 0, 0, 0, 0, NULL)
`;

const SELECT_CATALOG_SYNC_RUN_BY_ID_SQL = 'SELECT * FROM sync_runs WHERE id = ?';

const COMPLETE_CATALOG_SYNC_RUN_SQL = `
  UPDATE sync_runs SET
    completed_at = ?,
    status = ?,
    documents_checked = ?,
    documents_added = ?,
    documents_updated = ?,
    documents_unchanged = ?,
    documents_failed = ?,
    error_summary = ?
  WHERE id = ? AND status = 'RUNNING' AND completed_at IS NULL
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

type InsertCatalogSyncRunParams = [number | null, CatalogSyncRunKind, number];
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
];

export class SqliteCatalogSyncStore {
  public constructor(private readonly database: Database.Database) {}

  public start(input: CatalogSyncRunStartRequest): CatalogSyncRun {
    const info = this.database
      .prepare<InsertCatalogSyncRunParams>(INSERT_CATALOG_SYNC_RUN_SQL)
      .run(input.sourceId ?? null, input.runKind ?? 'EXECUTION', input.startedAt.getTime());
    const row = this.database
      .prepare<[number], CatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
      .get(Number(info.lastInsertRowid));
    if (row === undefined) throw new Error('CATALOG_SYNC_RUN_INSERT_FAILED');
    return toCatalogSyncRun(row);
  }

  public complete(syncRunId: number, input: CatalogSyncRunCompletionInput): CatalogSyncRun {
    const transaction = this.database.transaction((): CatalogSyncRunRow => {
      const running = this.database
        .prepare<[number], CatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(syncRunId);
      if (running === undefined) throw new Error('CATALOG_SYNC_RUN_NOT_FOUND');
      if (running.status !== 'RUNNING' || running.completed_at !== null) {
        throw new Error('CATALOG_SYNC_RUN_ALREADY_COMPLETED');
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
          syncRunId,
        );
      if (result.changes !== 1) throw new Error('CATALOG_SYNC_RUN_COMPLETION_FAILED');
      const row = this.database
        .prepare<[number], CatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(syncRunId);
      if (row === undefined) throw new Error('CATALOG_SYNC_RUN_COMPLETION_FAILED');
      return row;
    });
    return toCatalogSyncRun(transaction());
  }

  public persistObservation(
    documentId: number,
    observation: CatalogDocumentObservationInput | undefined,
    observedAt: number,
  ): void {
    if (observation === undefined) return;

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
