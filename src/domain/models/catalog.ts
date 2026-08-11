export type DocumentStatus = 'ACTIVE' | 'STALE' | 'REDIRECTED' | 'REMOVED' | 'UNAVAILABLE';

export type CatalogSourceType = 'documentation' | 'reference' | 'api' | 'guide';

export type CatalogFreshnessPolicy = 'manual' | 'daily' | 'weekly' | 'monthly';

export type CatalogSyncStrategy = 'manual' | 'polling';

export type CatalogSyncRunKind = 'EXECUTION' | 'PLAN';

export type CatalogSyncRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export type CatalogSyncRunTerminalStatus = Exclude<CatalogSyncRunStatus, 'RUNNING'>;

export type CatalogDocumentAliasType = 'OLD_URL' | 'REDIRECT' | 'CANONICAL';

export type CatalogStalenessEventType =
  | 'HTTP_404'
  | 'HTTP_410'
  | 'PERMANENT_REDIRECT'
  | 'CANONICAL_CHANGED'
  | 'SOURCE_UNAVAILABLE'
  | 'CONTENT_HASH_CHANGED';

export interface CatalogSource {
  readonly id: number;
  readonly sourceKey: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly sourceType: CatalogSourceType;
  readonly language: string;
  readonly freshnessPolicy: CatalogFreshnessPolicy;
  readonly syncStrategy: CatalogSyncStrategy;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewCatalogSource {
  readonly sourceKey: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly sourceType: CatalogSourceType;
  readonly language: string;
  readonly freshnessPolicy: CatalogFreshnessPolicy;
  readonly syncStrategy: CatalogSyncStrategy;
  readonly enabled: boolean;
}

export interface CatalogDocument {
  readonly id: number;
  readonly publicId: string;
  readonly sourceId: number;
  readonly canonicalUrl: string;
  readonly stableKey: string;
  readonly title: string;
  readonly mimeType: string;
  readonly language: string;
  readonly status: DocumentStatus;
  readonly currentVersionId?: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CatalogDocumentEntry {
  readonly source: CatalogSource;
  readonly document: CatalogDocument;
}

export interface CatalogDocumentInput {
  readonly publicId: string;
  readonly sourceId: number;
  readonly canonicalUrl: string;
  readonly stableKey: string;
  readonly title: string;
  readonly mimeType: string;
  readonly language: string;
  readonly status: DocumentStatus;
}

export interface DocumentVersion {
  readonly id: number;
  readonly documentId: number;
  readonly versionLabel?: string;
  readonly contentHash: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly publishedAt?: Date;
  readonly fetchedAt: Date;
  readonly isCurrent: boolean;
  readonly extractionMode: 'static' | 'native-render';
  readonly contentType: string;
  readonly metadataJson: string;
}

export interface DocumentVersionInput {
  readonly documentId: number;
  readonly versionLabel?: string;
  readonly contentHash: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly publishedAt?: Date;
  readonly isCurrent: boolean;
  readonly extractionMode: 'static' | 'native-render';
  readonly contentType: string;
  readonly metadataJson: string;
}

export interface DocumentSection {
  readonly id: number;
  readonly documentVersionId: number;
  readonly ordinal: number;
  readonly heading?: string;
  readonly headingPath?: string;
  readonly headingLevel?: number;
  readonly anchor?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly characterCount: number;
  readonly tokenCount?: number;
}

export interface DocumentSectionInput {
  readonly ordinal: number;
  readonly heading?: string;
  readonly headingPath?: string;
  readonly headingLevel?: number;
  readonly anchor?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly characterCount: number;
  readonly tokenCount?: number;
}

export type DocumentRevisionVersionInput = Omit<DocumentVersionInput, 'documentId' | 'isCurrent'>;

export interface CatalogDocumentRevisionInput {
  readonly document: CatalogDocumentInput;
  readonly version: DocumentRevisionVersionInput;
  readonly sections: readonly DocumentSectionInput[];
}

export interface CatalogDocumentRevision {
  readonly document: CatalogDocument;
  readonly version: DocumentVersion;
  readonly sections: readonly DocumentSection[];
}

export interface CatalogCurrentDocumentSection {
  readonly source: CatalogSource;
  readonly document: CatalogDocument;
  readonly section: DocumentSection;
}

export interface CatalogDocumentSearchQuery {
  readonly query: string;
  readonly sourceKey?: string;
  readonly language?: string;
  readonly limit?: number;
}

export interface CatalogDocumentSearchResult {
  readonly source: CatalogSource;
  readonly document: CatalogDocument;
  readonly section: DocumentSection;
  readonly snippet: string;
  readonly score: number;
}

export interface CatalogSearchIndexRebuildResult {
  readonly indexedSections: number;
}

export interface CatalogSyncRun {
  readonly id: number;
  readonly sourceId?: number;
  readonly runKind: CatalogSyncRunKind;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly status: CatalogSyncRunStatus;
  readonly documentsChecked: number;
  readonly documentsAdded: number;
  readonly documentsUpdated: number;
  readonly documentsUnchanged: number;
  readonly documentsFailed: number;
  readonly errorSummary?: string;
}

export interface CatalogSyncRunStartInput {
  readonly sourceId?: number;
  readonly runKind: CatalogSyncRunKind;
  readonly startedAt: Date;
}

export interface CatalogSyncRunCompletionInput {
  readonly completedAt: Date;
  readonly status: CatalogSyncRunTerminalStatus;
  readonly documentsChecked: number;
  readonly documentsAdded: number;
  readonly documentsUpdated: number;
  readonly documentsUnchanged: number;
  readonly documentsFailed: number;
  readonly errorSummary?: string;
}

export interface CatalogDocumentAliasObservationInput {
  readonly url: string;
  readonly aliasType: CatalogDocumentAliasType;
}

export interface CatalogStalenessEventObservationInput {
  readonly eventType: CatalogStalenessEventType;
  readonly detailsJson: string;
}

export interface CatalogDocumentObservationInput {
  readonly syncRunId: number;
  readonly aliases?: readonly CatalogDocumentAliasObservationInput[];
  readonly events?: readonly CatalogStalenessEventObservationInput[];
}
