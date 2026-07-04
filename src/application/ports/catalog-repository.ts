import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentInput,
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
  CatalogSearchIndexRebuildResult,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunInput,
  DocumentSection,
  DocumentSectionInput,
  DocumentVersion,
  DocumentVersionInput,
  NewCatalogSource,
} from '../../domain/models/catalog.js';

export interface CatalogRepository {
  addSource(source: NewCatalogSource): Promise<CatalogSource>;
  getSourceByKey(sourceKey: string): Promise<CatalogSource | undefined>;
  listSources(): Promise<readonly CatalogSource[]>;
  upsertDocument(document: CatalogDocumentInput): Promise<CatalogDocument>;
  addDocumentVersion(version: DocumentVersionInput): Promise<DocumentVersion>;
  replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): Promise<readonly DocumentSection[]>;
  getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined>;
  getCurrentDocumentVersion?(documentId: number): Promise<DocumentVersion | undefined>;
  readonly listDocumentVersions?: (documentId: number) => Promise<readonly DocumentVersion[]>;
  readonly getDocumentVersion?: (
    documentId: number,
    versionId: number,
  ) => Promise<DocumentVersion | undefined>;
  listDocuments(): Promise<readonly CatalogDocument[]>;
  listCurrentDocumentSections(): Promise<readonly CatalogCurrentDocumentSection[]>;
  rebuildSearchIndex(): Promise<CatalogSearchIndexRebuildResult>;
  addCatalogSyncRun(input: CatalogSyncRunInput): Promise<CatalogSyncRun>;
  searchDocuments(
    query: CatalogDocumentSearchQuery,
  ): Promise<readonly CatalogDocumentSearchResult[]>;
  close(): void;
}
