import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentEntry,
  CatalogFreshnessPolicy,
  CatalogSource,
  CatalogSourceType,
  CatalogSyncStrategy,
  DocumentSection,
  DocumentStatus,
} from '../../domain/models/catalog.js';
import { toCatalogDocument, toCatalogSource, toDocumentSection } from './catalog-row-mappers.js';

export interface CountRow {
  readonly count: number;
}

export interface CatalogJoinedSourceRow {
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

export interface CatalogJoinedDocumentRow {
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

export interface CatalogDocumentEntryRow extends CatalogJoinedSourceRow, CatalogJoinedDocumentRow {}

export interface CatalogCurrentDocumentSectionRow
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

export interface CatalogDocumentSearchRow extends CatalogCurrentDocumentSectionRow {
  readonly score: number;
}

export function toCatalogCurrentDocumentSection(
  row: CatalogCurrentDocumentSectionRow,
): CatalogCurrentDocumentSection {
  return {
    source: toCatalogSourceFromJoinedRow(row),
    document: toCatalogDocumentFromJoinedRow(row),
    section: toDocumentSectionFromJoinedRow(row),
  };
}

export function toCatalogDocumentEntry(row: CatalogDocumentEntryRow): CatalogDocumentEntry {
  return {
    source: toCatalogSourceFromJoinedRow(row),
    document: toCatalogDocumentFromJoinedRow(row),
  };
}

export function toCatalogSourceFromJoinedRow(row: CatalogJoinedSourceRow): CatalogSource {
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

export function toCatalogDocumentFromJoinedRow(row: CatalogJoinedDocumentRow): CatalogDocument {
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

export function toDocumentSectionFromJoinedRow(
  row: CatalogCurrentDocumentSectionRow,
): DocumentSection {
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
