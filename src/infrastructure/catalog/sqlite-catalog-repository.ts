import type Database from 'better-sqlite3';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentInput,
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
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
  SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL,
  SELECT_CATALOG_SOURCE_BY_KEY_SQL,
  SELECT_CATALOG_SOURCES_SQL,
  SELECT_CURRENT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENTS_SQL,
  SELECT_DOCUMENT_BY_PUBLIC_ID_SQL,
  SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL,
  SELECT_DOCUMENT_SECTIONS_SQL,
  SELECT_DOCUMENT_VERSION_BY_HASH_SQL,
  SET_DOCUMENT_CURRENT_VERSION_SQL,
  UPSERT_DOCUMENT_SQL,
  UPSERT_DOCUMENT_VERSION_SQL,
} from './catalog-sql.js';

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_SNIPPET_RADIUS = 80;

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

type SearchCurrentDocumentSectionsParams = [
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
  string,
  string,
  string,
  number,
];

interface CatalogCurrentDocumentSectionRow {
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

interface CatalogDocumentSearchRow extends CatalogCurrentDocumentSectionRow {
  readonly score: number;
}

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

        const insert = this.database.prepare<InsertDocumentSectionParams>(
          INSERT_DOCUMENT_SECTION_SQL,
        );
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

  public listCurrentDocumentSections(): Promise<readonly CatalogCurrentDocumentSection[]> {
    return this.asPromise(() => {
      const rows = this.database
        .prepare<[], CatalogCurrentDocumentSectionRow>(SELECT_CURRENT_DOCUMENT_SECTIONS_SQL)
        .all();
      return rows.map(toCatalogCurrentDocumentSection);
    });
  }

  public searchDocuments(
    query: CatalogDocumentSearchQuery,
  ): Promise<readonly CatalogDocumentSearchResult[]> {
    return this.asPromise(() => {
      const term = query.query.trim().toLocaleLowerCase();
      if (term.length === 0) return [];

      const pattern = `%${escapeLikePattern(term)}%`;
      const sourceKey = query.sourceKey ?? null;
      const language = query.language ?? null;
      const limit = normalizeSearchLimit(query.limit);
      const rows = this.database
        .prepare<
          SearchCurrentDocumentSectionsParams,
          CatalogDocumentSearchRow
        >(SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL)
        .all(
          pattern,
          pattern,
          pattern,
          sourceKey,
          sourceKey,
          language,
          language,
          pattern,
          pattern,
          pattern,
          pattern,
          limit,
        );

      return rows.map((row) => toCatalogDocumentSearchResult(row, term));
    });
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private asPromise<T>(operation: () => T): Promise<T> {
    return Promise.resolve().then(operation);
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

function normalizeSearchLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function toCatalogCurrentDocumentSection(
  row: CatalogCurrentDocumentSectionRow,
): CatalogCurrentDocumentSection {
  return {
    source: toCatalogSourceFromJoinedRow(row),
    document: toCatalogDocumentFromJoinedRow(row),
    section: toDocumentSectionFromJoinedRow(row),
  };
}

function toCatalogDocumentSearchResult(
  row: CatalogDocumentSearchRow,
  term: string,
): CatalogDocumentSearchResult {
  return {
    ...toCatalogCurrentDocumentSection(row),
    snippet: createSnippet(row.section_content, term),
    score: row.score,
  };
}

function toCatalogSourceFromJoinedRow(row: CatalogCurrentDocumentSectionRow): CatalogSource {
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

function toCatalogDocumentFromJoinedRow(row: CatalogCurrentDocumentSectionRow): CatalogDocument {
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

function toDocumentSectionFromJoinedRow(row: CatalogCurrentDocumentSectionRow): DocumentSection {
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

function createSnippet(content: string, term: string): string {
  const normalizedContent = content.toLocaleLowerCase();
  if (!normalizedContent.includes(term)) return content.slice(0, SEARCH_SNIPPET_RADIUS * 2).trim();

  const index = normalizedContent.indexOf(term);
  const start = Math.max(0, index - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(content.length, index + term.length + SEARCH_SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}
