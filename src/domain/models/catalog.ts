export type DocumentStatus = 'ACTIVE' | 'STALE' | 'REDIRECTED' | 'REMOVED' | 'UNAVAILABLE';

export type CatalogSourceType = 'documentation' | 'reference' | 'api' | 'guide';

export type CatalogFreshnessPolicy = 'manual' | 'daily' | 'weekly' | 'monthly';

export type CatalogSyncStrategy = 'manual' | 'polling';

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
