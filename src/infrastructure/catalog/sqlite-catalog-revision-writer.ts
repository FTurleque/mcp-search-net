import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogDocument,
  CatalogDocumentInput,
  CatalogDocumentObservationInput,
  CatalogDocumentRevision,
  CatalogDocumentRevisionInput,
  DocumentSection,
  DocumentSectionInput,
  DocumentStatus,
  DocumentVersion,
  DocumentVersionInput,
} from '../../domain/models/catalog.js';
import type {
  CatalogDocumentRow,
  DocumentSectionRow,
  DocumentVersionRow,
} from './catalog-row-mappers.js';
import { toCatalogDocument, toDocumentSection, toDocumentVersion } from './catalog-row-mappers.js';
import {
  CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL,
  DELETE_DOCUMENT_SECTIONS_SQL,
  DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL,
  INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL,
  INSERT_DOCUMENT_SECTION_SQL,
  SELECT_DOCUMENT_BY_ID_SQL,
  SELECT_DOCUMENT_BY_PUBLIC_ID_SQL,
  SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL,
  SELECT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENT_VERSION_BY_HASH_SQL,
  SET_DOCUMENT_CURRENT_VERSION_SQL,
  UPSERT_DOCUMENT_SQL,
  UPSERT_DOCUMENT_VERSION_SQL,
} from './catalog-sql.js';
import type { SqliteCatalogSyncStore } from './sqlite-catalog-sync-store.js';

const TOUCH_DOCUMENT_OBSERVATION_SQL = 'UPDATE documents SET last_seen_at = ? WHERE id = ?';
const SELECT_DOCUMENT_VERSION_STATE_SQL =
  'SELECT document_id, is_current FROM document_versions WHERE id = ?';
const MARK_DOCUMENT_VERSION_CURRENT_SQL = 'UPDATE document_versions SET is_current = 1 WHERE id = ?';

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

interface DocumentVersionStateRow {
  readonly document_id: number;
  readonly is_current: number;
}

export class SqliteCatalogRevisionWriter {
  private readonly pendingCurrentVersionIds = new Set<number>();

  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
    private readonly syncStore: SqliteCatalogSyncStore,
  ) {}

  public commit(
    revision: CatalogDocumentRevisionInput,
    observation?: CatalogDocumentObservationInput,
  ): CatalogDocumentRevision {
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

      this.database.prepare<[number]>(INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL).run(versionRow.id);
      const now = this.now();
      this.database
        .prepare<[number, number, number]>(SET_DOCUMENT_CURRENT_VERSION_SQL)
        .run(versionRow.id, now, documentRow.id);
      this.syncStore.persistObservation(documentRow.id, observation, now);
      this.pendingCurrentVersionIds.delete(versionRow.id);

      const currentDocumentRow = this.selectDocumentByPublicId(revision.document.publicId);
      if (currentDocumentRow === undefined) throw new Error('CATALOG_DOCUMENT_COMMIT_FAILED');

      return {
        document: toCatalogDocument(currentDocumentRow),
        version: toDocumentVersion(versionRow),
        sections: sectionRows.map(toDocumentSection),
      };
    });

    return transaction();
  }

  public upsertDocument(
    document: CatalogDocumentInput,
    observation?: CatalogDocumentObservationInput,
  ): CatalogDocument {
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
      this.syncStore.persistObservation(documentRow.id, observation, this.now());
      return documentRow;
    });
    return toCatalogDocument(transaction());
  }

  public touchDocumentObservation(
    documentId: number,
    observation?: CatalogDocumentObservationInput,
  ): CatalogDocument {
    const transaction = this.database.transaction((): CatalogDocumentRow => {
      const now = this.now();
      const result = this.database
        .prepare<[number, number]>(TOUCH_DOCUMENT_OBSERVATION_SQL)
        .run(now, documentId);
      if (result.changes !== 1) throw new Error('CATALOG_DOCUMENT_NOT_FOUND');
      this.syncStore.persistObservation(documentId, observation, now);
      const row = this.database
        .prepare<[number], CatalogDocumentRow>(SELECT_DOCUMENT_BY_ID_SQL)
        .get(documentId);
      if (row === undefined) throw new Error('CATALOG_DOCUMENT_TOUCH_FAILED');
      return row;
    });
    return toCatalogDocument(transaction());
  }

  public recordDocumentObservation(
    documentId: number,
    observation: CatalogDocumentObservationInput,
  ): void {
    const transaction = this.database.transaction(() => {
      const document = this.database
        .prepare<[number], CatalogDocumentRow>(SELECT_DOCUMENT_BY_ID_SQL)
        .get(documentId);
      if (document === undefined) throw new Error('CATALOG_DOCUMENT_NOT_FOUND');
      this.syncStore.persistObservation(documentId, observation, this.now());
    });
    transaction();
  }

  public addDocumentVersion(version: DocumentVersionInput): DocumentVersion {
    const transaction = this.database.transaction((): DocumentVersionRow => {
      const existing = this.database
        .prepare<[number, string], DocumentVersionRow>(SELECT_DOCUMENT_VERSION_BY_HASH_SQL)
        .get(version.documentId, version.contentHash);
      if (version.isCurrent && existing?.is_current === 1) {
        return this.upsertDocumentVersionRow(version);
      }

      const row = this.upsertDocumentVersionRow(
        version.isCurrent ? { ...version, isCurrent: false } : version,
      );
      if (version.isCurrent) this.pendingCurrentVersionIds.add(row.id);
      return row;
    });

    return toDocumentVersion(transaction());
  }

  public replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): readonly DocumentSection[] {
    const pendingPromotion = this.pendingCurrentVersionIds.has(documentVersionId);
    const transaction = this.database.transaction((): readonly DocumentSectionRow[] => {
      const version = this.database
        .prepare<[number], DocumentVersionStateRow>(SELECT_DOCUMENT_VERSION_STATE_SQL)
        .get(documentVersionId);
      if (version === undefined) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      if ((pendingPromotion || version.is_current === 1) && sections.length === 0) {
        throw new Error('CATALOG_CURRENT_REVISION_REQUIRES_SECTIONS');
      }

      const rows = this.replaceDocumentSectionRows(documentVersionId, sections);
      if (pendingPromotion) {
        this.database
          .prepare<[number]>(DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL)
          .run(version.document_id);
        this.database
          .prepare<[number]>(CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL)
          .run(version.document_id);
        this.database.prepare<[number]>(MARK_DOCUMENT_VERSION_CURRENT_SQL).run(documentVersionId);
        this.database
          .prepare<[number]>(INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL)
          .run(documentVersionId);
        this.database
          .prepare<[number, number, number]>(SET_DOCUMENT_CURRENT_VERSION_SQL)
          .run(documentVersionId, this.now(), version.document_id);
      } else if (version.is_current === 1) {
        this.database
          .prepare<[number]>(DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL)
          .run(version.document_id);
        this.database
          .prepare<[number]>(INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL)
          .run(documentVersionId);
      }
      return rows;
    });
    const rows = transaction();
    if (pendingPromotion) this.pendingCurrentVersionIds.delete(documentVersionId);
    return rows.map(toDocumentSection);
  }

  private now(): number {
    return this.clock.now().getTime();
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

    return this.database
      .prepare<[number], DocumentSectionRow>(SELECT_DOCUMENT_SECTIONS_SQL)
      .all(documentVersionId);
  }

  private selectDocumentByPublicId(publicId: string): CatalogDocumentRow | undefined {
    return this.database
      .prepare<[string], CatalogDocumentRow>(SELECT_DOCUMENT_BY_PUBLIC_ID_SQL)
      .get(publicId);
  }
}
