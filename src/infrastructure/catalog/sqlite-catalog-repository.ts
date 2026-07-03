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

interface CatalogSourceRow {
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

interface CatalogDocumentRow {
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

interface DocumentVersionRow {
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

interface DocumentSectionRow {
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
        .prepare<
          [
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
          ]
        >(
          `
          INSERT INTO catalog_sources (
            source_key, display_name, base_url, source_type, language,
            freshness_policy, sync_strategy, enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
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
      const rows = this.database
        .prepare<[], CatalogSourceRow>('SELECT * FROM catalog_sources ORDER BY source_key')
        .all();
      return rows.map(toCatalogSource);
    });
  }

  public upsertDocument(document: CatalogDocumentInput): Promise<CatalogDocument> {
    return this.asPromise(() => {
      const now = this.now();
      this.database
        .prepare<
          [
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
          ]
        >(
          `
          INSERT INTO documents (
            public_id, source_id, canonical_url, stable_key, title, mime_type,
            language, status, first_seen_at, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, stable_key) DO UPDATE SET
            canonical_url = excluded.canonical_url,
            title = excluded.title,
            mime_type = excluded.mime_type,
            language = excluded.language,
            status = excluded.status,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        `,
        )
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
        .prepare<[number, string], CatalogDocumentRow>(
          'SELECT * FROM documents WHERE source_id = ? AND stable_key = ?',
        )
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
            .prepare<[number]>('UPDATE document_versions SET is_current = 0 WHERE document_id = ?')
            .run(version.documentId);
        }

        this.database
          .prepare<
            [
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
            ]
          >(
            `
            INSERT INTO document_versions (
              document_id, version_label, content_hash, etag, last_modified,
              published_at, fetched_at, is_current, extraction_mode, content_type, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(document_id, content_hash) DO UPDATE SET
              version_label = excluded.version_label,
              etag = excluded.etag,
              last_modified = excluded.last_modified,
              published_at = excluded.published_at,
              fetched_at = excluded.fetched_at,
              is_current = excluded.is_current,
              extraction_mode = excluded.extraction_mode,
              content_type = excluded.content_type,
              metadata_json = excluded.metadata_json
          `,
          )
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
          .prepare<[number, string], DocumentVersionRow>(
            'SELECT * FROM document_versions WHERE document_id = ? AND content_hash = ?',
          )
          .get(version.documentId, version.contentHash);
        if (row === undefined) throw new Error('DOCUMENT_VERSION_INSERT_FAILED');

        if (version.isCurrent) {
          this.database
            .prepare<[number, number, number]>(
              'UPDATE documents SET current_version_id = ?, updated_at = ? WHERE id = ?',
            )
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
        this.database
          .prepare<[number]>('DELETE FROM document_sections WHERE document_version_id = ?')
          .run(documentVersionId);

        const insert = this.database.prepare<
          [
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
          ]
        >(`
          INSERT INTO document_sections (
            document_version_id, ordinal, heading, heading_path, heading_level, anchor,
            content, content_hash, character_count, token_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

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
      const rows = this.database
        .prepare<[], CatalogDocumentRow>('SELECT * FROM documents ORDER BY source_id, stable_key')
        .all();
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
      .prepare<[string], CatalogSourceRow>('SELECT * FROM catalog_sources WHERE source_key = ?')
      .get(sourceKey);
  }

  private selectDocumentByPublicId(publicId: string): CatalogDocumentRow | undefined {
    return this.database
      .prepare<[string], CatalogDocumentRow>('SELECT * FROM documents WHERE public_id = ?')
      .get(publicId);
  }

  private selectSectionsByVersionId(documentVersionId: number): readonly DocumentSectionRow[] {
    return this.database
      .prepare<[number], DocumentSectionRow>(
        'SELECT * FROM document_sections WHERE document_version_id = ? ORDER BY ordinal',
      )
      .all(documentVersionId);
  }
}

function toCatalogSource(row: CatalogSourceRow): CatalogSource {
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

function toCatalogDocument(row: CatalogDocumentRow): CatalogDocument {
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

function toDocumentVersion(row: DocumentVersionRow): DocumentVersion {
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

function toDocumentSection(row: DocumentSectionRow): DocumentSection {
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
