import type Database from 'better-sqlite3';

import {
  MAX_CATALOG_PAGE_SIZE,
  type CatalogDocumentFilters,
  type CatalogDocumentPageQuery,
  type CatalogPage,
  type CatalogPageQuery,
  type CatalogSectionPageQuery,
} from '../../application/ports/catalog-repository.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentEntry,
  DocumentVersion,
} from '../../domain/models/catalog.js';
import type { CatalogDocumentRow, DocumentVersionRow } from './catalog-row-mappers.js';
import { toCatalogDocument, toDocumentVersion } from './catalog-row-mappers.js';
import {
  COUNT_DOCUMENT_VERSIONS_SQL,
  createCountCurrentDocumentSectionsSql,
  createCountDocumentsSql,
  createCurrentDocumentSectionsPageSql,
  createDocumentEntriesPageSql,
  SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL,
  SELECT_CURRENT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENT_BY_ID_SQL,
  SELECT_DOCUMENTS_SQL,
  SELECT_DOCUMENT_BY_PUBLIC_ID_SQL,
  SELECT_DOCUMENT_VERSIONS_SQL,
  SELECT_DOCUMENT_VERSIONS_PAGE_SQL,
  SELECT_DOCUMENT_VERSION_BY_ID_SQL,
} from './catalog-sql.js';
import type {
  CatalogCurrentDocumentSectionRow,
  CatalogDocumentEntryRow,
  CountRow,
} from './sqlite-catalog-row-views.js';
import {
  toCatalogCurrentDocumentSection,
  toCatalogDocumentEntry,
} from './sqlite-catalog-row-views.js';

const MAX_CATALOG_PAGE_OFFSET = 1_000_000;
const SELECT_CURRENT_DOCUMENT_VERSION_SQL = `
  SELECT document_versions.*
  FROM documents
  INNER JOIN document_versions
    ON document_versions.id = documents.current_version_id
   AND document_versions.document_id = documents.id
   AND document_versions.is_current = 1
  WHERE documents.id = ?
`;

export class SqliteCatalogReadModel {
  public constructor(private readonly database: Database.Database) {}

  public getDocumentByPublicId(publicId: string): CatalogDocument | undefined {
    const row = this.database
      .prepare<[string], CatalogDocumentRow>(SELECT_DOCUMENT_BY_PUBLIC_ID_SQL)
      .get(publicId);
    return row === undefined ? undefined : toCatalogDocument(row);
  }

  public getDocumentById(documentId: number): CatalogDocument | undefined {
    const row = this.database
      .prepare<[number], CatalogDocumentRow>(SELECT_DOCUMENT_BY_ID_SQL)
      .get(documentId);
    return row === undefined ? undefined : toCatalogDocument(row);
  }

  public getCurrentDocumentVersion(documentId: number): DocumentVersion | undefined {
    const row = this.database
      .prepare<[number], DocumentVersionRow>(SELECT_CURRENT_DOCUMENT_VERSION_SQL)
      .get(documentId);
    return row === undefined ? undefined : toDocumentVersion(row);
  }

  public listDocumentVersions(documentId: number): readonly DocumentVersion[] {
    return this.database
      .prepare<[number], DocumentVersionRow>(SELECT_DOCUMENT_VERSIONS_SQL)
      .all(documentId)
      .map(toDocumentVersion);
  }

  public getDocumentVersion(documentId: number, versionId: number): DocumentVersion | undefined {
    const row = this.database
      .prepare<[number, number], DocumentVersionRow>(SELECT_DOCUMENT_VERSION_BY_ID_SQL)
      .get(documentId, versionId);
    return row === undefined ? undefined : toDocumentVersion(row);
  }

  public listDocumentVersionsPage(
    documentId: number,
    query: CatalogPageQuery,
  ): CatalogPage<DocumentVersion> {
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
  }

  public listDocuments(): readonly CatalogDocument[] {
    return this.database
      .prepare<[], CatalogDocumentRow>(SELECT_DOCUMENTS_SQL)
      .all()
      .map(toCatalogDocument);
  }

  public listDocumentsPage(query: CatalogDocumentPageQuery): CatalogPage<CatalogDocumentEntry> {
    assertCatalogPageQuery(query);
    const statement = createDocumentEntriesPageSql(query);
    const rows = this.database
      .prepare<(string | number)[], CatalogDocumentEntryRow>(statement.sql)
      .all(...statement.parameters);
    return {
      offset: query.offset,
      limit: query.limit,
      total: this.countDocuments(query),
      items: rows.map(toCatalogDocumentEntry),
    };
  }

  public countDocuments(filters: CatalogDocumentFilters = {}): number {
    const statement = createCountDocumentsSql(filters);
    const row = this.database
      .prepare<(string | number)[], CountRow>(statement.sql)
      .get(...statement.parameters);
    return row?.count ?? 0;
  }

  public listCurrentDocumentSections(): readonly CatalogCurrentDocumentSection[] {
    return this.database
      .prepare<[], CatalogCurrentDocumentSectionRow>(SELECT_CURRENT_DOCUMENT_SECTIONS_SQL)
      .all()
      .map(toCatalogCurrentDocumentSection);
  }

  public getCurrentDocumentSectionById(
    sectionId: number,
  ): CatalogCurrentDocumentSection | undefined {
    const row = this.database
      .prepare<
        [number],
        CatalogCurrentDocumentSectionRow
      >(SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL)
      .get(sectionId);
    return row === undefined ? undefined : toCatalogCurrentDocumentSection(row);
  }

  public listCurrentDocumentSectionsPage(
    query: CatalogSectionPageQuery,
  ): CatalogPage<CatalogCurrentDocumentSection> {
    assertCatalogPageQuery(query);
    const statement = createCurrentDocumentSectionsPageSql(query);
    const rows = this.database
      .prepare<(string | number)[], CatalogCurrentDocumentSectionRow>(statement.sql)
      .all(...statement.parameters);
    return {
      offset: query.offset,
      limit: query.limit,
      total: this.countCurrentDocumentSections(query),
      items: rows.map(toCatalogCurrentDocumentSection),
    };
  }

  public countCurrentDocumentSections(filters: CatalogDocumentFilters = {}): number {
    const statement = createCountCurrentDocumentSectionsSql(filters);
    const row = this.database
      .prepare<(string | number)[], CountRow>(statement.sql)
      .get(...statement.parameters);
    return row?.count ?? 0;
  }
}

function assertCatalogPageQuery(query: CatalogPageQuery): void {
  if (
    !Number.isSafeInteger(query.offset) ||
    query.offset < 0 ||
    query.offset > MAX_CATALOG_PAGE_OFFSET
  ) {
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
