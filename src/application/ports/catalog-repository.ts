import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentEntry,
  CatalogDocumentInput,
  CatalogDocumentRevision,
  CatalogDocumentRevisionInput,
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
  CatalogSearchIndexRebuildResult,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunInput,
  DocumentVersion,
  DocumentStatus,
  NewCatalogSource,
} from '../../domain/models/catalog.js';

export const MAX_CATALOG_PAGE_SIZE = 50;

export interface CatalogPageQuery {
  readonly offset: number;
  readonly limit: number;
}

export interface CatalogDocumentFilters {
  readonly sourceKey?: string;
  readonly language?: string;
  readonly status?: DocumentStatus;
}

export interface CatalogDocumentPageQuery extends CatalogPageQuery, CatalogDocumentFilters {}

export interface CatalogSectionPageQuery extends CatalogPageQuery, CatalogDocumentFilters {}

export interface CatalogSourcePageQuery extends CatalogPageQuery {
  readonly enabled?: boolean;
}

export interface CatalogPage<T> {
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly items: readonly T[];
}

export type CatalogIntegrityIssueCode =
  | 'SQLITE_INTEGRITY_CHECK_FAILED'
  | 'SQLITE_FOREIGN_KEY_CHECK_FAILED'
  | 'ACTIVE_DOCUMENT_WITHOUT_CURRENT_VERSION'
  | 'CURRENT_VERSION_MISSING_OR_WRONG_DOCUMENT'
  | 'CURRENT_VERSION_NOT_MARKED_CURRENT'
  | 'CURRENT_VERSION_WITHOUT_SECTIONS'
  | 'CURRENT_VERSION_FLAG_NOT_POINTED'
  | 'CURRENT_SECTION_MISSING_FROM_FTS'
  | 'FTS_ENTRY_ORPHANED';

export interface CatalogIntegrityIssue {
  readonly code: CatalogIntegrityIssueCode;
  readonly message: string;
  readonly sourceKey?: string;
  readonly documentPublicId?: string;
  readonly sectionId?: number;
}

export interface CatalogIntegrityReport {
  readonly sqliteIntegrityCheck: string;
  readonly counts: {
    readonly sources: number;
    readonly enabledSources: number;
    readonly documents: number;
    readonly activeDocuments: number;
    readonly currentSections: number;
    readonly indexedSections: number;
  };
  readonly issues: readonly CatalogIntegrityIssue[];
}

export interface CatalogRepository {
  addSource(source: NewCatalogSource): Promise<CatalogSource>;
  getSourceByKey(sourceKey: string): Promise<CatalogSource | undefined>;
  getSourceById(sourceId: number): Promise<CatalogSource | undefined>;
  listSources(): Promise<readonly CatalogSource[]>;
  listSourcesPage(query: CatalogSourcePageQuery): Promise<CatalogPage<CatalogSource>>;
  countSources(enabled?: boolean): Promise<number>;
  commitDocumentRevision(revision: CatalogDocumentRevisionInput): Promise<CatalogDocumentRevision>;
  upsertDocument(document: CatalogDocumentInput): Promise<CatalogDocument>;
  getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined>;
  getDocumentById(documentId: number): Promise<CatalogDocument | undefined>;
  getCurrentDocumentVersion?(documentId: number): Promise<DocumentVersion | undefined>;
  readonly listDocumentVersions?: (documentId: number) => Promise<readonly DocumentVersion[]>;
  readonly getDocumentVersion?: (
    documentId: number,
    versionId: number,
  ) => Promise<DocumentVersion | undefined>;
  listDocumentVersionsPage(
    documentId: number,
    query: CatalogPageQuery,
  ): Promise<CatalogPage<DocumentVersion>>;
  listDocuments(): Promise<readonly CatalogDocument[]>;
  listDocumentsPage(query: CatalogDocumentPageQuery): Promise<CatalogPage<CatalogDocumentEntry>>;
  countDocuments(filters?: CatalogDocumentFilters): Promise<number>;
  listCurrentDocumentSections(): Promise<readonly CatalogCurrentDocumentSection[]>;
  getCurrentDocumentSectionById(
    sectionId: number,
  ): Promise<CatalogCurrentDocumentSection | undefined>;
  listCurrentDocumentSectionsPage(
    query: CatalogSectionPageQuery,
  ): Promise<CatalogPage<CatalogCurrentDocumentSection>>;
  countCurrentDocumentSections(filters?: CatalogDocumentFilters): Promise<number>;
  verifyIntegrity(): Promise<CatalogIntegrityReport>;
  rebuildSearchIndex(): Promise<CatalogSearchIndexRebuildResult>;
  addCatalogSyncRun(input: CatalogSyncRunInput): Promise<CatalogSyncRun>;
  searchDocuments(
    query: CatalogDocumentSearchQuery,
  ): Promise<readonly CatalogDocumentSearchResult[]>;
  close(): void;
}
