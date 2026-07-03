import type {
  CatalogDocument,
  CatalogFreshnessPolicy,
  CatalogSource,
  CatalogSourceType,
  CatalogSyncStrategy,
  DocumentSection,
  DocumentStatus,
  DocumentVersion,
} from '../../domain/models/catalog.js';

export interface CatalogSourceRow {
  readonly id: number;
  readonly source_key: string;
  readonly display_name: string;
  readonly base_url: string;
  readonly source_type: CatalogSourceType;
  readonly language: string;
  readonly freshness_policy: CatalogFreshnessPolicy;
  readonly sync_strategy: CatalogSyncStrategy;
  readonly enabled: number;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface CatalogDocumentRow {
  readonly id: number;
  readonly public_id: string;
  readonly source_id: number;
  readonly canonical_url: string;
  readonly stable_key: string;
  readonly title: string;
  readonly mime_type: string;
  readonly language: string;
  readonly status: DocumentStatus;
  readonly current_version_id: number | null;
  readonly first_seen_at: number;
  readonly last_seen_at: number;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface DocumentVersionRow {
  readonly id: number;
  readonly document_id: number;
  readonly version_label: string | null;
  readonly content_hash: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly published_at: number | null;
  readonly fetched_at: number;
  readonly is_current: number;
  readonly extraction_mode: 'static' | 'native-render';
  readonly content_type: string;
  readonly metadata_json: string;
}

export interface DocumentSectionRow {
  readonly id: number;
  readonly document_version_id: number;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly heading_path: string | null;
  readonly heading_level: number | null;
  readonly anchor: string | null;
  readonly content: string;
  readonly content_hash: string;
  readonly character_count: number;
  readonly token_count: number | null;
}

export function toCatalogSource(row: CatalogSourceRow): CatalogSource {
  return {
    id: row.id,
    sourceKey: row.source_key,
    displayName: row.display_name,
    baseUrl: row.base_url,
    sourceType: row.source_type,
    language: row.language,
    freshnessPolicy: row.freshness_policy,
    syncStrategy: row.sync_strategy,
    enabled: row.enabled === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function toCatalogDocument(row: CatalogDocumentRow): CatalogDocument {
  return {
    id: row.id,
    publicId: row.public_id,
    sourceId: row.source_id,
    canonicalUrl: row.canonical_url,
    stableKey: row.stable_key,
    title: row.title,
    mimeType: row.mime_type,
    language: row.language,
    status: row.status,
    ...(row.current_version_id === null ? {} : { currentVersionId: row.current_version_id }),
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function toDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    ...(row.version_label === null ? {} : { versionLabel: row.version_label }),
    contentHash: row.content_hash,
    ...(row.etag === null ? {} : { etag: row.etag }),
    ...(row.last_modified === null ? {} : { lastModified: row.last_modified }),
    ...(row.published_at === null ? {} : { publishedAt: new Date(row.published_at) }),
    fetchedAt: new Date(row.fetched_at),
    isCurrent: row.is_current === 1,
    extractionMode: row.extraction_mode,
    contentType: row.content_type,
    metadataJson: row.metadata_json,
  };
}

export function toDocumentSection(row: DocumentSectionRow): DocumentSection {
  return {
    id: row.id,
    documentVersionId: row.document_version_id,
    ordinal: row.ordinal,
    ...(row.heading === null ? {} : { heading: row.heading }),
    ...(row.heading_path === null ? {} : { headingPath: row.heading_path }),
    ...(row.heading_level === null ? {} : { headingLevel: row.heading_level }),
    ...(row.anchor === null ? {} : { anchor: row.anchor }),
    content: row.content,
    contentHash: row.content_hash,
    characterCount: row.character_count,
    ...(row.token_count === null ? {} : { tokenCount: row.token_count }),
  };
}
