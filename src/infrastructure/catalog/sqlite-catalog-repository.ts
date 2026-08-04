import type Database from 'better-sqlite3';

import {
  MAX_CATALOG_PAGE_SIZE,
  type CatalogDocumentFilters,
  type CatalogDocumentPageQuery,
  type CatalogPage,
  type CatalogPageQuery,
  type CatalogRepository,
  type CatalogSectionPageQuery,
  type CatalogSourcePageQuery,
} from '../../application/ports/catalog-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentEntry,
  CatalogDocumentInput,
  CatalogDocumentObservationInput,
  CatalogDocumentRevision,
  CatalogDocumentRevisionInput,
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
  CatalogFreshnessPolicy,
  CatalogSearchIndexRebuildResult,
  CatalogSource,
  CatalogSourceType,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunStartInput,
  CatalogSyncRunStatus,
  CatalogSyncStrategy,
  DocumentSection,
  DocumentSectionInput,
  DocumentStatus,
  DocumentVersion,
  DocumentVersionInput,
  NewCatalogSource,
} from '../../domain/models/catalog.js';
import { openCatalogDatabase } from './catalog-database.js';
import { CatalogMigrationRunner } from './catalog-migration-runner.js';
import { verifyCatalogIntegrity } from './catalog-integrity.js';
import type {
  CatalogDocumentRow,
  CatalogSourceRow,
  CatalogSyncRunRow,
  DocumentSectionRow,
  DocumentVersionRow,
} from './catalog-row-mappers.js';
import {
  toCatalogDocument,
  toCatalogSource,
  toCatalogSyncRun,
  toDocumentSection,
  toDocumentVersion,
} from './catalog-row-mappers.js';
import {
  CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL,
  COUNT_DOCUMENT_SECTION_FTS_SQL,
  COUNT_DOCUMENT_VERSIONS_SQL,
  createCatalogSourcesPageSql,
  createCountCatalogSourcesSql,
  createCountCurrentDocumentSectionsSql,
  createCountDocumentsSql,
  createCurrentDocumentSectionsPageSql,
  createDocumentEntriesPageSql,
  DELETE_DOCUMENT_SECTIONS_SQL,
  DELETE_DOCUMENT_SECTION_FTS_SQL,
  DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL,
  INSERT_CATALOG_SOURCE_SQL,
  INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL,
  INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL,
  INSERT_DOCUMENT_SECTION_SQL,
  SEARCH_CURRENT_DOCUMENT_SECTIONS_FTS_SQL,
  SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL,
  SELECT_CATALOG_SOURCE_BY_KEY_SQL,
  SELECT_CATALOG_SOURCE_BY_ID_SQL,
  SELECT_CATALOG_SOURCES_SQL,
  SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL,
  SELECT_CURRENT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENT_BY_ID_SQL,
  SELECT_DOCUMENTS_SQL,
  SELECT_DOCUMENT_BY_PUBLIC_ID_SQL,
  SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL,
  SELECT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENT_VERSIONS_SQL,
  SELECT_DOCUMENT_VERSIONS_PAGE_SQL,
  SELECT_DOCUMENT_VERSION_BY_HASH_SQL,
  SELECT_DOCUMENT_VERSION_BY_ID_SQL,
  SET_DOCUMENT_CURRENT_VERSION_SQL,
  UPSERT_DOCUMENT_SQL,
  UPSERT_DOCUMENT_VERSION_SQL,
} from './catalog-sql.js';

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_SNIPPET_RADIUS = 80;
const MAX_SNIPPET_TERMS = 32;
const MAX_SNIPPET_OCCURRENCES_PER_TERM = 16;

const INSERT_CATALOG_SYNC_RUN_SQL = `
  INSERT INTO sync_runs (
    source_id, started_at, completed_at, status,
    documents_checked, documents_added, documents_updated, documents_unchanged,
    documents_failed, error_summary
  ) VALUES (?, ?, NULL, 'RUNNING', 0, 0, 0, 0, 0, NULL)
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

const TOUCH_DOCUMENT_OBSERVATION_SQL = 'UPDATE documents SET last_seen_at = ? WHERE id = ?';

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

const SELECT_CURRENT_DOCUMENT_VERSION_SQL = `
  SELECT document_versions.*
  FROM documents
  INNER JOIN document_versions
    ON document_versions.id = documents.current_version_id
   AND document_versions.document_id = documents.id
   AND document_versions.is_current = 1
  WHERE documents.id = ?
`;

type InsertCatalogSourceParams = [
  string,
  string,
  string,
  CatalogSourceType,
  string,
  CatalogFreshnessPolicy,
  CatalogSyncStrategy,
  number,
  number,
  number,
];

type UpsertDocumentParams = [
  string,
  number,
  string,
  string,
  string,
  string,
  string,
  DocumentStatus,
  number,
  number,
  number,
  number,
];

type UpsertDocumentVersionParams = [
  number,
  string | null,
  string,
  string | null,
  string | null,
  number | null,
  number,
  number,
  'static' | 'native-render',
  string,
  string,
];

type InsertDocumentSectionParams = [
  number,
  number,
  string | null,
  string | null,
  number | null,
  string | null,
  string,
  string,
  number,
  number | null,
];

type InsertCatalogSyncRunParams = [number | null, number];

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

type SearchCurrentDocumentSectionsParams = [
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
  string,
  string,
  string,
  number,
];

type SearchCurrentDocumentSectionsFtsParams = [
  string,
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  number,
];

interface CountRow {
  readonly count: number;
}

interface CatalogJoinedSourceRow {
  readonly source_id: number;
  readonly source_source_key: string;
  readonly source_display_name: string;
  readonly source_base_url: string;
  readonly source_source_type: CatalogSourceType;
  readonly source_language: string;
  readonly source_freshness_policy: CatalogFreshnessPolicy;
  readonly source_sync_strategy: CatalogSyncStrategy;
  readonly source_enabled: number;
  readonly source_created_at: number;
  readonly source_updated_at: number;
}

interface CatalogJoinedDocumentRow {
  readonly document_id: number;
  readonly document_public_id: string;
  readonly document_source_id: number;
  readonly document_canonical_url: string;
  readonly document_stable_key: string;
  readonly document_title: string;
  readonly document_mime_type: string;
  readonly document_language: string;
  readonly document_status: DocumentStatus;
  readonly document_current_version_id: number | null;
  readonly document_first_seen_at: number;
  readonly document_last_seen_at: number;
  readonly document_created_at: number;
  readonly document_updated_at: number;
}

interface CatalogDocumentEntryRow extends CatalogJoinedSourceRow, CatalogJoinedDocumentRow {}

interface CatalogCurrentDocumentSectionRow
  extends CatalogJoinedSourceRow,
    CatalogJoinedDocumentRow {
  readonly section_id: number;
  readonly section_document_version_id: number;
  readonly section_ordinal: number;
  readonly section_heading: string | null;
  readonly section_heading_path: string | null;
  readonly section_heading_level: number | null;
  readonly section_anchor: string | null;
  readonly section_content: string;
  readonly section_content_hash: string;
  readonly section_character_count: number;
  readonly section_token_count: number | null;
}

interface CatalogDocumentSearchRow extends CatalogCurrentDocumentSectionRow {
  readonly score: number;
}

export class SqliteCatalogRepository implements CatalogRepository {
  private readonly database: Database.Database;

  public constructor(
    path: string,
    private readonly clock: Clock,
  ) {
    this.database = openCatalogDatabase(path);
    new CatalogMigrationRunner(this.database, this.clock).apply();
  }

  public addSource(source: NewCatalogSource): Promise<CatalogSource> {
    return this.asPromise(() => {
      const now = this.now();
      this.database
        .prepare<InsertCatalogSourceParams>(INSERT_CATALOG_SOURCE_SQL)
        .run(
          source.sourceKey,
          source.displayName,
          source.baseUrl,
          source.sourceType,
          source.language,
          source.freshnessPolicy,
          source.syncStrategy,
          source.enabled ? 1 : 0,
          now,
          now,
        );

      const row = this.selectSourceByKey(source.sourceKey);
      if (row === undefined) throw new Error('CATALOG_SOURCE_INSERT_FAILED');
      return toCatalogSource(row);
    });
  }

  public getSourceByKey(sourceKey: string): Promise<CatalogSource | undefined> {
    return this.asPromise(() => {
      const row = this.selectSourceByKey(sourceKey);
      return row === undefined ? undefined : toCatalogSource(row);
    });
  }

  public getSourceById(sourceId: number): Promise<CatalogSource | undefined> {
    return this.asPromise(() => {
      const row = this.database
        .prepare<[number], CatalogSourceRow>(SELECT_CATALOG_SOURCE_BY_ID_SQL)
        .get(sourceId);
      return row === undefined ? undefined : toCatalogSource(row);
    });
  }

  public listSources(): Promise<readonly CatalogSource[]> {
    return this.asPromise(() => {
      const rows = this.database.prepare<[], CatalogSourceRow>(SELECT_CATALOG_SOURCES_SQL).all();
      return rows.map(toCatalogSource);
    });
  }

  public listSourcesPage(query: CatalogSourcePageQuery): Promise<CatalogPage<CatalogSource>> {
    return this.asPromise(() => {
      assertCatalogPageQuery(query);
      const statement = createCatalogSourcesPageSql(query.offset, query.limit, query.enabled);
      const rows = this.database
        .prepare<(string | number)[], CatalogSourceRow>(statement.sql)
        .all(...statement.parameters);
      return {
        offset: query.offset,
        limit: query.limit,
        total: this.countSourceRows(query.enabled),
        items: rows.map(toCatalogSource),
      };
    });
  }

  public countSources(enabled?: boolean): Promise<number> {
    return this.asPromise(() => this.countSourceRows(enabled));
  }

  public commitDocumentRevision(
    revision: CatalogDocumentRevisionInput,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocumentRevision> {
    return this.asPromise(() => {
      const transaction = this.database.transaction((): CatalogDocumentRevision => {
        if (revision.sections.length === 0) {
          throw new Error('CATALOG_DOCUMENT_REVISION_REQUIRES_SECTIONS');
        }
        const documentRow = this.upsertDocumentRow(revision.document);
        this.database
          .prepare<[number]>(DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL)
          .run(documentRow.id);
        this.database.prepare<[number]>(CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL).run(documentRow.id);

        const versionRow = this.upsertDocumentVersionRow({
          ...revision.version,
          documentId: documentRow.id,
          isCurrent: true,
        });
        const sectionRows = this.replaceDocumentSectionRows(versionRow.id, revision.sections);

        this.database
          .prepare<[number]>(INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL)
          .run(versionRow.id);
        const now = this.now();
        this.database
          .prepare<[number, number, number]>(SET_DOCUMENT_CURRENT_VERSION_SQL)
          .run(versionRow.id, now, documentRow.id);
        this.persistDocumentObservation(documentRow.id, observation, now);

        const currentDocumentRow = this.selectDocumentByPublicId(revision.document.publicId);
        if (currentDocumentRow === undefined) throw new Error('CATALOG_DOCUMENT_COMMIT_FAILED');

        return {
          document: toCatalogDocument(currentDocumentRow),
          version: toDocumentVersion(versionRow),
          sections: sectionRows.map(toDocumentSection),
        };
      });

      return transaction();
    });
  }

  public upsertDocument(
    document: CatalogDocumentInput,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocument> {
    return this.asPromise(() => {
      const transaction = this.database.transaction((): CatalogDocumentRow => {
        const documentRow = this.upsertDocumentRow(document);
        this.database
          .prepare<[number]>(DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL)
          .run(documentRow.id);
        if (documentRow.current_version_id !== null) {
          this.database
            .prepare<[number]>(INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL)
            .run(documentRow.current_version_id);
        }
        this.persistDocumentObservation(documentRow.id, observation, this.now());
        return documentRow;
      });
      return toCatalogDocument(transaction());
    });
  }

  public touchDocumentObservation(
    documentId: number,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocument> {
    return this.asPromise(() => {
      const transaction = this.database.transaction((): CatalogDocumentRow => {
        const now = this.now();
        const result = this.database
          .prepare<[number, number]>(TOUCH_DOCUMENT_OBSERVATION_SQL)
          .run(now, documentId);
        if (result.changes !== 1) throw new Error('CATALOG_DOCUMENT_NOT_FOUND');
        this.persistDocumentObservation(documentId, observation, now);
        const row = this.database
          .prepare<[number], CatalogDocumentRow>(SELECT_DOCUMENT_BY_ID_SQL)
          .get(documentId);
        if (row === undefined) throw new Error('CATALOG_DOCUMENT_TOUCH_FAILED');
        return row;
      });
      return toCatalogDocument(transaction());
    });
  }

  public recordDocumentObservation(
    documentId: number,
    observation: CatalogDocumentObservationInput,
  ): Promise<void> {
    return this.asPromise(() => {
      const transaction = this.database.transaction(() => {
        const document = this.database
          .prepare<[number], CatalogDocumentRow>(SELECT_DOCUMENT_BY_ID_SQL)
          .get(documentId);
        if (document === undefined) throw new Error('CATALOG_DOCUMENT_NOT_FOUND');
        this.persistDocumentObservation(documentId, observation, this.now());
      });
      transaction();
    });
  }

  public addDocumentVersion(version: DocumentVersionInput): Promise<DocumentVersion> {
    return this.asPromise(() => {
      const now = this.now();
      const transaction = this.database.transaction((): DocumentVersionRow => {
        if (version.isCurrent) {
          this.database
            .prepare<[number]>(CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL)
            .run(version.documentId);
        }

        const row = this.upsertDocumentVersionRow(version);

        if (version.isCurrent) {
          this.database
            .prepare<[number, number, number]>(SET_DOCUMENT_CURRENT_VERSION_SQL)
            .run(row.id, now, version.documentId);
        }

        return row;
      });

      return toDocumentVersion(transaction());
    });
  }

  public replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): Promise<readonly DocumentSection[]> {
    return this.asPromise(() => {
      const transaction = this.database.transaction(() =>
        this.replaceDocumentSectionRows(documentVersionId, sections),
      );

      return transaction().map(toDocumentSection);
    });
  }

  public getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined> {
    return this.asPromise(() => {
      const row = this.selectDocumentByPublicId(publicId);
      return row === undefined ? undefined : toCatalogDocument(row);
    });
  }

  public getDocumentById(documentId: number): Promise<CatalogDocument | undefined> {
    return this.asPromise(() => {
      const row = this.database
        .prepare<[number], CatalogDocumentRow>(SELECT_DOCUMENT_BY_ID_SQL)
        .get(documentId);
      return row === undefined ? undefined : toCatalogDocument(row);
    });
  }

  public getCurrentDocumentVersion(documentId: number): Promise<DocumentVersion | undefined> {
    return this.asPromise(() => {
      const row = this.database
        .prepare<[number], DocumentVersionRow>(SELECT_CURRENT_DOCUMENT_VERSION_SQL)
        .get(documentId);
      return row === undefined ? undefined : toDocumentVersion(row);
    });
  }

  public listDocumentVersions(documentId: number): Promise<readonly DocumentVersion[]> {
    return this.asPromise(() => {
      const rows = this.database
        .prepare<[number], DocumentVersionRow>(SELECT_DOCUMENT_VERSIONS_SQL)
        .all(documentId);
      return rows.map(toDocumentVersion);
    });
  }

  public getDocumentVersion(
    documentId: number,
    versionId: number,
  ): Promise<DocumentVersion | undefined> {
    return this.asPromise(() => {
      const row = this.database
        .prepare<[number, number], DocumentVersionRow>(SELECT_DOCUMENT_VERSION_BY_ID_SQL)
        .get(documentId, versionId);
      return row === undefined ? undefined : toDocumentVersion(row);
    });
  }

  public listDocumentVersionsPage(
    documentId: number,
    query: CatalogPageQuery,
  ): Promise<CatalogPage<DocumentVersion>> {
    return this.asPromise(() => {
      assertCatalogPageQuery(query);
      const rows = this.database
        .prepare<[number, number, number], DocumentVersionRow>(SELECT_DOCUMENT_VERSIONS_PAGE_SQL)
        .all(documentId, query.limit, query.offset);
      const count = this.database
        .prepare<[number], CountRow>(COUNT_DOCUMENT_VERSIONS_SQL)
        .get(documentId);
      return {
        offset: query.offset,
        limit: query.limit,
        total: count?.count ?? 0,
        items: rows.map(toDocumentVersion),
      };
    });
  }

  public listDocuments(): Promise<readonly CatalogDocument[]> {
    return this.asPromise(() => {
      const rows = this.database.prepare<[], CatalogDocumentRow>(SELECT_DOCUMENTS_SQL).all();
      return rows.map(toCatalogDocument);
    });
  }

  public listDocumentsPage(
    query: CatalogDocumentPageQuery,
  ): Promise<CatalogPage<CatalogDocumentEntry>> {
    return this.asPromise(() => {
      assertCatalogPageQuery(query);
      const statement = createDocumentEntriesPageSql(query);
      const rows = this.database
        .prepare<(string | number)[], CatalogDocumentEntryRow>(statement.sql)
        .all(...statement.parameters);
      return {
        offset: query.offset,
        limit: query.limit,
        total: this.countDocumentRows(query),
        items: rows.map(toCatalogDocumentEntry),
      };
    });
  }

  public countDocuments(filters: CatalogDocumentFilters = {}): Promise<number> {
    return this.asPromise(() => this.countDocumentRows(filters));
  }

  public listCurrentDocumentSections(): Promise<readonly CatalogCurrentDocumentSection[]> {
    return this.asPromise(() => {
      const rows = this.database
        .prepare<[], CatalogCurrentDocumentSectionRow>(SELECT_CURRENT_DOCUMENT_SECTIONS_SQL)
        .all();
      return rows.map(toCatalogCurrentDocumentSection);
    });
  }

  public getCurrentDocumentSectionById(
    sectionId: number,
  ): Promise<CatalogCurrentDocumentSection | undefined> {
    return this.asPromise(() => {
      const row = this.database
        .prepare<
          [number],
          CatalogCurrentDocumentSectionRow
        >(SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL)
        .get(sectionId);
      return row === undefined ? undefined : toCatalogCurrentDocumentSection(row);
    });
  }

  public listCurrentDocumentSectionsPage(
    query: CatalogSectionPageQuery,
  ): Promise<CatalogPage<CatalogCurrentDocumentSection>> {
    return this.asPromise(() => {
      assertCatalogPageQuery(query);
      const statement = createCurrentDocumentSectionsPageSql(query);
      const rows = this.database
        .prepare<(string | number)[], CatalogCurrentDocumentSectionRow>(statement.sql)
        .all(...statement.parameters);
      return {
        offset: query.offset,
        limit: query.limit,
        total: this.countCurrentDocumentSectionRows(query),
        items: rows.map(toCatalogCurrentDocumentSection),
      };
    });
  }

  public countCurrentDocumentSections(filters: CatalogDocumentFilters = {}): Promise<number> {
    return this.asPromise(() => this.countCurrentDocumentSectionRows(filters));
  }

  public verifyIntegrity() {
    return this.asPromise(() => verifyCatalogIntegrity(this.database));
  }

  public rebuildSearchIndex(): Promise<CatalogSearchIndexRebuildResult> {
    return this.asPromise(() => {
      const transaction = this.database.transaction((): CatalogSearchIndexRebuildResult => {
        this.database.prepare(DELETE_DOCUMENT_SECTION_FTS_SQL).run();
        this.database.prepare(INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL).run();
        const row = this.database.prepare<[], CountRow>(COUNT_DOCUMENT_SECTION_FTS_SQL).get();
        return { indexedSections: row?.count ?? 0 };
      });

      return transaction();
    });
  }

  public startCatalogSyncRun(input: CatalogSyncRunStartInput): Promise<CatalogSyncRun> {
    return this.asPromise(() => {
      const info = this.database
        .prepare<InsertCatalogSyncRunParams>(INSERT_CATALOG_SYNC_RUN_SQL)
        .run(input.sourceId ?? null, input.startedAt.getTime());
      const row = this.database
        .prepare<[number], CatalogSyncRunRow>(SELECT_CATALOG_SYNC_RUN_BY_ID_SQL)
        .get(Number(info.lastInsertRowid));
      if (row === undefined) throw new Error('CATALOG_SYNC_RUN_INSERT_FAILED');
      return toCatalogSyncRun(row);
    });
  }

  public completeCatalogSyncRun(
    syncRunId: number,
    input: CatalogSyncRunCompletionInput,
  ): Promise<CatalogSyncRun> {
    return this.asPromise(() => {
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
    });
  }

  public searchDocuments(
    query: CatalogDocumentSearchQuery,
  ): Promise<readonly CatalogDocumentSearchResult[]> {
    return this.asPromise(() => {
      const term = query.query.trim().toLocaleLowerCase();
      if (term.length === 0) return [];

      const pattern = `%${escapeLikePattern(term)}%`;
      const sourceKey = query.sourceKey ?? null;
      const language = query.language ?? null;
      const limit = normalizeSearchLimit(query.limit);
      const ftsQuery = createFtsQuery(term);
      const ftsRows =
        ftsQuery === undefined
          ? []
          : this.searchDocumentsWithFts(ftsQuery, pattern, sourceKey, language, limit);
      const rows =
        ftsRows.length > 0
          ? ftsRows
          : this.searchDocumentsWithLike(pattern, sourceKey, language, limit);

      return rows.map((row) => toCatalogDocumentSearchResult(row, term));
    });
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private countSourceRows(enabled?: boolean): number {
    const statement = createCountCatalogSourcesSql(enabled);
    const row = this.database
      .prepare<(string | number)[], CountRow>(statement.sql)
      .get(...statement.parameters);
    return row?.count ?? 0;
  }

  private countDocumentRows(filters: CatalogDocumentFilters): number {
    const statement = createCountDocumentsSql(filters);
    const row = this.database
      .prepare<(string | number)[], CountRow>(statement.sql)
      .get(...statement.parameters);
    return row?.count ?? 0;
  }

  private countCurrentDocumentSectionRows(filters: CatalogDocumentFilters): number {
    const statement = createCountCurrentDocumentSectionsSql(filters);
    const row = this.database
      .prepare<(string | number)[], CountRow>(statement.sql)
      .get(...statement.parameters);
    return row?.count ?? 0;
  }

  private asPromise<T>(operation: () => T): Promise<T> {
    return Promise.resolve().then(operation);
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  private selectSourceByKey(sourceKey: string): CatalogSourceRow | undefined {
    return this.database
      .prepare<[string], CatalogSourceRow>(SELECT_CATALOG_SOURCE_BY_KEY_SQL)
      .get(sourceKey);
  }

  private upsertDocumentRow(document: CatalogDocumentInput): CatalogDocumentRow {
    const now = this.now();
    this.database
      .prepare<UpsertDocumentParams>(UPSERT_DOCUMENT_SQL)
      .run(
        document.publicId,
        document.sourceId,
        document.canonicalUrl,
        document.stableKey,
        document.title,
        document.mimeType,
        document.language,
        document.status,
        now,
        now,
        now,
        now,
      );

    const row = this.selectDocumentByPublicId(document.publicId);
    if (row !== undefined) return row;

    const stableRow = this.database
      .prepare<[number, string], CatalogDocumentRow>(SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL)
      .get(document.sourceId, document.stableKey);
    if (stableRow === undefined) throw new Error('CATALOG_DOCUMENT_UPSERT_FAILED');
    return stableRow;
  }

  private upsertDocumentVersionRow(version: DocumentVersionInput): DocumentVersionRow {
    this.database
      .prepare<UpsertDocumentVersionParams>(UPSERT_DOCUMENT_VERSION_SQL)
      .run(
        version.documentId,
        version.versionLabel ?? null,
        version.contentHash,
        version.etag ?? null,
        version.lastModified ?? null,
        version.publishedAt?.getTime() ?? null,
        this.now(),
        version.isCurrent ? 1 : 0,
        version.extractionMode,
        version.contentType,
        version.metadataJson,
      );

    const row = this.database
      .prepare<[number, string], DocumentVersionRow>(SELECT_DOCUMENT_VERSION_BY_HASH_SQL)
      .get(version.documentId, version.contentHash);
    if (row === undefined) throw new Error('DOCUMENT_VERSION_INSERT_FAILED');
    return row;
  }

  private replaceDocumentSectionRows(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): readonly DocumentSectionRow[] {
    this.database.prepare<[number]>(DELETE_DOCUMENT_SECTIONS_SQL).run(documentVersionId);

    const insert = this.database.prepare<InsertDocumentSectionParams>(INSERT_DOCUMENT_SECTION_SQL);
    for (const section of sections) {
      insert.run(
        documentVersionId,
        section.ordinal,
        section.heading ?? null,
        section.headingPath ?? null,
        section.headingLevel ?? null,
        section.anchor ?? null,
        section.content,
        section.contentHash,
        section.characterCount,
        section.tokenCount ?? null,
      );
    }

    return this.selectSectionsByVersionId(documentVersionId);
  }

  private selectDocumentByPublicId(publicId: string): CatalogDocumentRow | undefined {
    return this.database
      .prepare<[string], CatalogDocumentRow>(SELECT_DOCUMENT_BY_PUBLIC_ID_SQL)
      .get(publicId);
  }

  private selectSectionsByVersionId(documentVersionId: number): readonly DocumentSectionRow[] {
    return this.database
      .prepare<[number], DocumentSectionRow>(SELECT_DOCUMENT_SECTIONS_SQL)
      .all(documentVersionId);
  }

  private persistDocumentObservation(
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

  private searchDocumentsWithFts(
    ftsQuery: string,
    pattern: string,
    sourceKey: string | null,
    language: string | null,
    limit: number,
  ): readonly CatalogDocumentSearchRow[] {
    return this.database
      .prepare<
        SearchCurrentDocumentSectionsFtsParams,
        CatalogDocumentSearchRow
      >(SEARCH_CURRENT_DOCUMENT_SECTIONS_FTS_SQL)
      .all(pattern, pattern, pattern, ftsQuery, sourceKey, sourceKey, language, language, limit);
  }

  private searchDocumentsWithLike(
    pattern: string,
    sourceKey: string | null,
    language: string | null,
    limit: number,
  ): readonly CatalogDocumentSearchRow[] {
    return this.database
      .prepare<
        SearchCurrentDocumentSectionsParams,
        CatalogDocumentSearchRow
      >(SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL)
      .all(
        pattern,
        pattern,
        pattern,
        sourceKey,
        sourceKey,
        language,
        language,
        pattern,
        pattern,
        pattern,
        pattern,
        limit,
      );
  }
}

function normalizeSearchLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

function assertCatalogPageQuery(query: CatalogPageQuery): void {
  if (!Number.isSafeInteger(query.offset) || query.offset < 0) {
    throw new Error('CATALOG_PAGE_OFFSET_INVALID');
  }
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > MAX_CATALOG_PAGE_SIZE
  ) {
    throw new Error('CATALOG_PAGE_LIMIT_INVALID');
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

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function createFtsQuery(value: string): string | undefined {
  const terms = value
    .split(/\s+/u)
    .map((term) => term.replaceAll('"', '').trim())
    .filter((term) => term.length > 0);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

function toCatalogCurrentDocumentSection(
  row: CatalogCurrentDocumentSectionRow,
): CatalogCurrentDocumentSection {
  return {
    source: toCatalogSourceFromJoinedRow(row),
    document: toCatalogDocumentFromJoinedRow(row),
    section: toDocumentSectionFromJoinedRow(row),
  };
}

function toCatalogDocumentEntry(row: CatalogDocumentEntryRow): CatalogDocumentEntry {
  return {
    source: toCatalogSourceFromJoinedRow(row),
    document: toCatalogDocumentFromJoinedRow(row),
  };
}

function toCatalogDocumentSearchResult(
  row: CatalogDocumentSearchRow,
  term: string,
): CatalogDocumentSearchResult {
  return {
    ...toCatalogCurrentDocumentSection(row),
    snippet: createSnippet(row.section_content, term),
    score: row.score,
  };
}

function toCatalogSourceFromJoinedRow(row: CatalogJoinedSourceRow): CatalogSource {
  return toCatalogSource({
    id: row.source_id,
    source_key: row.source_source_key,
    display_name: row.source_display_name,
    base_url: row.source_base_url,
    source_type: row.source_source_type,
    language: row.source_language,
    freshness_policy: row.source_freshness_policy,
    sync_strategy: row.source_sync_strategy,
    enabled: row.source_enabled,
    created_at: row.source_created_at,
    updated_at: row.source_updated_at,
  });
}

function toCatalogDocumentFromJoinedRow(row: CatalogJoinedDocumentRow): CatalogDocument {
  return toCatalogDocument({
    id: row.document_id,
    public_id: row.document_public_id,
    source_id: row.document_source_id,
    canonical_url: row.document_canonical_url,
    stable_key: row.document_stable_key,
    title: row.document_title,
    mime_type: row.document_mime_type,
    language: row.document_language,
    status: row.document_status,
    current_version_id: row.document_current_version_id,
    first_seen_at: row.document_first_seen_at,
    last_seen_at: row.document_last_seen_at,
    created_at: row.document_created_at,
    updated_at: row.document_updated_at,
  });
}

function toDocumentSectionFromJoinedRow(row: CatalogCurrentDocumentSectionRow): DocumentSection {
  return toDocumentSection({
    id: row.section_id,
    document_version_id: row.section_document_version_id,
    ordinal: row.section_ordinal,
    heading: row.section_heading,
    heading_path: row.section_heading_path,
    heading_level: row.section_heading_level,
    anchor: row.section_anchor,
    content: row.section_content,
    content_hash: row.section_content_hash,
    character_count: row.section_character_count,
    token_count: row.section_token_count,
  });
}

function createSnippet(content: string, term: string): string {
  const snippetLength = SEARCH_SNIPPET_RADIUS * 2;
  const start = findBestMultiTermSnippetStart(content, term, snippetLength);
  const end = Math.min(content.length, start + snippetLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

function findBestMultiTermSnippetStart(
  content: string,
  query: string,
  snippetLength: number,
): number {
  const normalizedContent = normalizeSnippetText(content);
  const terms = extractSnippetTerms(query);
  if (terms.length === 0) return 0;

  const termIndexes = new Map(terms.map((candidate, index) => [candidate, index] as const));
  const occurrenceCounts = new Array<number>(terms.length).fill(0);
  const occurrences: SnippetOccurrence[] = [];
  for (const match of normalizedContent.value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const matchedToken = match[0];
    const termIndex = termIndexes.get(matchedToken);
    if (termIndex === undefined) continue;
    if (occurrenceCounts[termIndex]! >= MAX_SNIPPET_OCCURRENCES_PER_TERM) continue;

    const normalizedStart = match.index;
    const normalizedEnd = normalizedStart + matchedToken.length;
    const originalStart = normalizedContent.originalStarts[normalizedStart];
    const originalEnd = normalizedContent.originalEnds[normalizedEnd - 1];
    if (originalStart === undefined || originalEnd === undefined) continue;
    occurrences.push({ termIndex, originalStart, originalEnd });
    occurrenceCounts[termIndex]! += 1;
  }
  if (occurrences.length === 0) return 0;

  let bestStart = 0;
  let bestMatchedTerms = -1;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const anchor of occurrences) {
    const start = snippetWindowStart(anchor.originalStart, content.length, snippetLength);
    const end = Math.min(content.length, start + snippetLength);
    const matchedTermIndexes = new Set<number>();
    let firstMatch = end;
    let lastMatch = start;
    for (const occurrence of occurrences) {
      if (occurrence.originalStart < start || occurrence.originalStart >= end) continue;
      matchedTermIndexes.add(occurrence.termIndex);
      firstMatch = Math.min(firstMatch, occurrence.originalStart);
      lastMatch = Math.max(lastMatch, Math.min(end, occurrence.originalEnd));
    }
    const matchedTerms = matchedTermIndexes.size;
    const span = matchedTerms === 0 ? Number.POSITIVE_INFINITY : lastMatch - firstMatch;
    if (
      matchedTerms > bestMatchedTerms ||
      (matchedTerms === bestMatchedTerms && span < bestSpan) ||
      (matchedTerms === bestMatchedTerms && span === bestSpan && start < bestStart)
    ) {
      bestStart = start;
      bestMatchedTerms = matchedTerms;
      bestSpan = span;
    }
  }
  return bestStart;
}

interface NormalizedSnippetText {
  readonly value: string;
  readonly originalStarts: readonly number[];
  readonly originalEnds: readonly number[];
}

interface SnippetOccurrence {
  readonly termIndex: number;
  readonly originalStart: number;
  readonly originalEnd: number;
}

function normalizeSnippetText(value: string): NormalizedSnippetText {
  let normalizedValue = '';
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  let originalStart = 0;

  for (const character of value) {
    const originalEnd = originalStart + character.length;
    const normalizedCharacter = character
      .normalize('NFD')
      .toLowerCase()
      .replace(/\p{M}/gu, '');
    normalizedValue += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      originalStarts.push(originalStart);
      originalEnds.push(originalEnd);
    }
    originalStart = originalEnd;
  }

  return { value: normalizedValue, originalStarts, originalEnds };
}

function extractSnippetTerms(query: string): readonly string[] {
  const normalizedQuery = normalizeSnippetText(query).value;
  const terms = new Set<string>();
  for (const match of normalizedQuery.matchAll(/[\p{L}\p{N}]+/gu)) {
    terms.add(match[0]);
    if (terms.size >= MAX_SNIPPET_TERMS) break;
  }
  return [...terms];
}

function snippetWindowStart(
  position: number,
  contentLength: number,
  snippetLength: number,
): number {
  return Math.min(
    Math.max(0, position - SEARCH_SNIPPET_RADIUS),
    Math.max(0, contentLength - snippetLength),
  );
}
