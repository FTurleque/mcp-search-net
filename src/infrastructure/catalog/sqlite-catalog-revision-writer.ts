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
import {
  MAX_CATALOG_VERSION_LABEL_CHARACTERS,
  MAX_EXTERNAL_ANCHOR_CHARACTERS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
  MAX_PERSISTED_DOCUMENT_SECTIONS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';
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
} from './catalog-sql.js';
import type { SqliteCatalogSyncStore } from './sqlite-catalog-sync-store.js';

const TOUCH_DOCUMENT_OBSERVATION_SQL = 'UPDATE documents SET last_seen_at = ? WHERE id = ?';
const SELECT_DOCUMENT_VERSION_STATE_SQL =
  'SELECT document_id, is_current, pending_current FROM document_versions WHERE id = ?';
const MARK_DOCUMENT_VERSION_CURRENT_SQL =
  'UPDATE document_versions SET is_current = 1, pending_current = 0 WHERE id = ?';
const UPSERT_DOCUMENT_VERSION_WITH_PENDING_SQL = `
  INSERT INTO document_versions (
    document_id, version_label, content_hash, etag, last_modified,
    published_at, fetched_at, is_current, pending_current, extraction_mode, content_type, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(document_id, content_hash) DO UPDATE SET
    version_label = excluded.version_label,
    etag = excluded.etag,
    last_modified = excluded.last_modified,
    published_at = excluded.published_at,
    fetched_at = excluded.fetched_at,
    is_current = excluded.is_current,
    pending_current = excluded.pending_current,
    extraction_mode = excluded.extraction_mode,
    content_type = excluded.content_type,
    metadata_json = excluded.metadata_json
`;

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
  readonly pending_current: number;
}

export class SqliteCatalogRevisionWriter {
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

      const versionRow = this.upsertDocumentVersionRow(
        {
          ...revision.version,
          documentId: documentRow.id,
          isCurrent: true,
        },
        false,
      );
      const sectionRows = this.replaceDocumentSectionRows(versionRow.id, revision.sections);

      this.database.prepare<[number]>(INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL).run(versionRow.id);
      const now = this.now();
      this.database
        .prepare<[number, number, number]>(SET_DOCUMENT_CURRENT_VERSION_SQL)
        .run(versionRow.id, now, documentRow.id);
      this.syncStore.persistObservation(documentRow.id, observation, now);

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
      if (existing?.is_current === 1) {
        return this.upsertDocumentVersionRow({ ...version, isCurrent: true }, false);
      }

      return this.upsertDocumentVersionRow(
        version.isCurrent ? { ...version, isCurrent: false } : version,
        version.isCurrent,
      );
    });

    return toDocumentVersion(transaction());
  }

  public replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): readonly DocumentSection[] {
    const transaction = this.database.transaction((): readonly DocumentSectionRow[] => {
      const version = this.database
        .prepare<[number], DocumentVersionStateRow>(SELECT_DOCUMENT_VERSION_STATE_SQL)
        .get(documentVersionId);
      if (version === undefined) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      const pendingPromotion = version.pending_current === 1;
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
    return transaction().map(toDocumentSection);
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

  private upsertDocumentVersionRow(
    version: DocumentVersionInput,
    pendingCurrent: boolean,
  ): DocumentVersionRow {
    this.database
      .prepare<UpsertDocumentVersionParams>(UPSERT_DOCUMENT_VERSION_WITH_PENDING_SQL)
      .run(
        version.documentId,
        boundOptionalText(version.versionLabel, MAX_CATALOG_VERSION_LABEL_CHARACTERS) ?? null,
        version.contentHash,
        version.etag ?? null,
        version.lastModified ?? null,
        version.publishedAt?.getTime() ?? null,
        this.now(),
        version.isCurrent ? 1 : 0,
        pendingCurrent ? 1 : 0,
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
    if (sections.length > MAX_PERSISTED_DOCUMENT_SECTIONS) {
      throw new Error('CATALOG_DOCUMENT_SECTION_LIMIT_EXCEEDED');
    }
    this.database.prepare<[number]>(DELETE_DOCUMENT_SECTIONS_SQL).run(documentVersionId);

    const insert = this.database.prepare<InsertDocumentSectionParams>(INSERT_DOCUMENT_SECTION_SQL);
    for (const section of sections) {
      insert.run(
        documentVersionId,
        section.ordinal,
        boundOptionalText(section.heading, MAX_EXTERNAL_HEADING_CHARACTERS) ?? null,
        boundOptionalText(section.headingPath, MAX_EXTERNAL_HEADING_PATH_CHARACTERS) ?? null,
        section.headingLevel ?? null,
        boundOptionalText(section.anchor, MAX_EXTERNAL_ANCHOR_CHARACTERS) ?? null,
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

function boundOptionalText(
  value: string | undefined,
  maximumCharacters: number,
): string | undefined {
  return value === undefined ? undefined : truncateUnicode(value, maximumCharacters);
}
