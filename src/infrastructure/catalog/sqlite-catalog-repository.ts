import type Database from 'better-sqlite3';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogDocument,
  CatalogDocumentInput,
  CatalogFreshnessPolicy,
  CatalogSource,
  CatalogSourceType,
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
import type {
  CatalogDocumentRow,
  CatalogSourceRow,
  DocumentSectionRow,
  DocumentVersionRow,
} from './catalog-row-mappers.js';
import {
  toCatalogDocument,
  toCatalogSource,
  toDocumentSection,
  toDocumentVersion,
} from './catalog-row-mappers.js';
import {
  CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL,
  DELETE_DOCUMENT_SECTIONS_SQL,
  INSERT_CATALOG_SOURCE_SQL,
  INSERT_DOCUMENT_SECTION_SQL,
  SELECT_CATALOG_SOURCE_BY_KEY_SQL,
  SELECT_CATALOG_SOURCES_SQL,
  SELECT_DOCUMENTS_SQL,
  SELECT_DOCUMENT_BY_PUBLIC_ID_SQL,
  SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL,
  SELECT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENT_VERSION_BY_HASH_SQL,
  SET_DOCUMENT_CURRENT_VERSION_SQL,
  UPSERT_DOCUMENT_SQL,
  UPSERT_DOCUMENT_VERSION_SQL,
} from './catalog-sql.js';

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

  public listSources(): Promise<readonly CatalogSource[]> {
    return this.asPromise(() => {
      const rows = this.database.prepare<[], CatalogSourceRow>(SELECT_CATALOG_SOURCES_SQL).all();
      return rows.map(toCatalogSource);
    });
  }

  public upsertDocument(document: CatalogDocumentInput): Promise<CatalogDocument> {
    return this.asPromise(() => {
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
      if (row !== undefined) return toCatalogDocument(row);

      const stableRow = this.database
        .prepare<[number, string], CatalogDocumentRow>(SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL)
        .get(document.sourceId, document.stableKey);
      if (stableRow === undefined) throw new Error('CATALOG_DOCUMENT_UPSERT_FAILED');
      return toCatalogDocument(stableRow);
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

        this.database
          .prepare<UpsertDocumentVersionParams>(UPSERT_DOCUMENT_VERSION_SQL)
          .run(
            version.documentId,
            version.versionLabel ?? null,
            version.contentHash,
            version.etag ?? null,
            version.lastModified ?? null,
            version.publishedAt?.getTime() ?? null,
            now,
            version.isCurrent ? 1 : 0,
            version.extractionMode,
            version.contentType,
            version.metadataJson,
          );

        const row = this.database
          .prepare<[number, string], DocumentVersionRow>(SELECT_DOCUMENT_VERSION_BY_HASH_SQL)
          .get(version.documentId, version.contentHash);
        if (row === undefined) throw new Error('DOCUMENT_VERSION_INSERT_FAILED');

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
      const transaction = this.database.transaction((): readonly DocumentSectionRow[] => {
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
      });

      return transaction().map(toDocumentSection);
    });
  }

  public getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined> {
    return this.asPromise(() => {
      const row = this.selectDocumentByPublicId(publicId);
      return row === undefined ? undefined : toCatalogDocument(row);
    });
  }

  public listDocuments(): Promise<readonly CatalogDocument[]> {
    return this.asPromise(() => {
      const rows = this.database.prepare<[], CatalogDocumentRow>(SELECT_DOCUMENTS_SQL).all();
      return rows.map(toCatalogDocument);
    });
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private asPromise<T>(operation: () => T): Promise<T> {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  private selectSourceByKey(sourceKey: string): CatalogSourceRow | undefined {
    return this.database
      .prepare<[string], CatalogSourceRow>(SELECT_CATALOG_SOURCE_BY_KEY_SQL)
      .get(sourceKey);
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
}
