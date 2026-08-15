import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import type { CatalogSearchIndexRebuildResult } from '../../domain/models/catalog.js';
import type {
  CatalogVersionPurgeInput,
  CatalogVersionPurgeRepository,
  CatalogVersionPurgeResult,
} from '../../application/use-cases/purge-catalog-versions.js';
import { openCatalogDatabase } from './catalog-database.js';
import { CatalogMigrationRunner } from './catalog-migration-runner.js';
import {
  COUNT_DOCUMENT_SECTION_FTS_SQL,
  DELETE_DOCUMENT_SECTION_FTS_SQL,
  INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL,
} from './catalog-sql.js';

const SQLITE_ID_BATCH_SIZE = 400;

const SELECT_SCANNED_DOCUMENT_COUNT_SQL = `
  SELECT count(DISTINCT documents.id) AS count
  FROM documents
  INNER JOIN catalog_sources
    ON catalog_sources.id = documents.source_id
  WHERE (? IS NULL OR catalog_sources.source_key = ?)
`;

const SELECT_PURGEABLE_DOCUMENT_VERSION_IDS_SQL = `
  SELECT document_versions.id AS id
  FROM document_versions
  INNER JOIN documents
    ON documents.id = document_versions.document_id
  INNER JOIN catalog_sources
    ON catalog_sources.id = documents.source_id
  WHERE document_versions.is_current = 0
    AND document_versions.pending_current = 0
    AND (? IS NULL OR catalog_sources.source_key = ?)
    AND (
      SELECT count(*)
      FROM document_versions AS newer_document_versions
      WHERE newer_document_versions.document_id = document_versions.document_id
        AND newer_document_versions.is_current = 0
        AND newer_document_versions.pending_current = 0
        AND (
          newer_document_versions.fetched_at > document_versions.fetched_at
          OR (
            newer_document_versions.fetched_at = document_versions.fetched_at
            AND newer_document_versions.id > document_versions.id
          )
        )
    ) >= ?
  ORDER BY documents.id, document_versions.fetched_at, document_versions.id
`;

interface CountRow {
  readonly count: number;
}

interface PurgeableDocumentVersionRow {
  readonly id: number;
}

export class SqliteCatalogVersionPurger implements CatalogVersionPurgeRepository {
  private readonly database: Database.Database;

  public constructor(
    path: string,
    private readonly clock: Clock,
  ) {
    this.database = openCatalogDatabase(path);
    new CatalogMigrationRunner(this.database, this.clock).apply();
  }

  public purgeOldDocumentVersions(
    input: CatalogVersionPurgeInput,
  ): Promise<CatalogVersionPurgeResult> {
    return Promise.resolve().then(() => {
      const sourceKey = input.sourceKey ?? null;
      if (input.dryRun) return this.inspectPurgeCandidates(sourceKey, input);

      const purge = this.database.transaction((): CatalogVersionPurgeResult => {
        const result = this.inspectPurgeCandidates(sourceKey, input);
        if (result.candidateVersions === 0) return result;
        const versionIds = this.selectPurgeableDocumentVersionIds(
          sourceKey,
          input.keepPreviousVersions,
        );
        const purgedSections = this.deleteSectionsByVersionIds(versionIds);
        const purgedVersions = this.deleteVersionsByIds(versionIds);
        return {
          ...result,
          candidateVersions: versionIds.length,
          candidateSections: purgedSections,
          purgedVersions,
          purgedSections,
        };
      });

      // Reserve the writer before candidate selection so a concurrent revision cannot
      // promote one of the selected versions between the read and delete phases.
      return purge.immediate();
    });
  }

  public rebuildSearchIndex(): Promise<CatalogSearchIndexRebuildResult> {
    return Promise.resolve().then(() => {
      const transaction = this.database.transaction((): CatalogSearchIndexRebuildResult => {
        this.database.prepare(DELETE_DOCUMENT_SECTION_FTS_SQL).run();
        this.database.prepare(INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL).run();
        const row = this.database.prepare<[], CountRow>(COUNT_DOCUMENT_SECTION_FTS_SQL).get();
        return { indexedSections: row?.count ?? 0 };
      });

      return transaction();
    });
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private inspectPurgeCandidates(
    sourceKey: string | null,
    input: CatalogVersionPurgeInput,
  ): CatalogVersionPurgeResult {
    const scannedDocuments = this.countScannedDocuments(sourceKey);
    const versionIds = this.selectPurgeableDocumentVersionIds(
      sourceKey,
      input.keepPreviousVersions,
    );
    return {
      dryRun: input.dryRun,
      keptPreviousVersions: input.keepPreviousVersions,
      scannedDocuments,
      candidateVersions: versionIds.length,
      candidateSections: this.countSectionsByVersionIds(versionIds),
      purgedVersions: 0,
      purgedSections: 0,
    };
  }

  private countScannedDocuments(sourceKey: string | null): number {
    const row = this.database
      .prepare<[string | null, string | null], CountRow>(SELECT_SCANNED_DOCUMENT_COUNT_SQL)
      .get(sourceKey, sourceKey);
    return row?.count ?? 0;
  }

  private selectPurgeableDocumentVersionIds(
    sourceKey: string | null,
    keepPreviousVersions: number,
  ): readonly number[] {
    const rows = this.database
      .prepare<
        [string | null, string | null, number],
        PurgeableDocumentVersionRow
      >(SELECT_PURGEABLE_DOCUMENT_VERSION_IDS_SQL)
      .all(sourceKey, sourceKey, keepPreviousVersions);
    return rows.map((row) => row.id);
  }

  private countSectionsByVersionIds(versionIds: readonly number[]): number {
    let total = 0;
    for (const batch of chunkIds(versionIds)) {
      const row = this.database
        .prepare(
          `SELECT count(*) AS count FROM document_sections WHERE document_version_id IN (${createPlaceholders(batch.length)})`,
        )
        .get(...batch) as CountRow | undefined;
      total += row?.count ?? 0;
    }
    return total;
  }

  private deleteSectionsByVersionIds(versionIds: readonly number[]): number {
    let deleted = 0;
    for (const batch of chunkIds(versionIds)) {
      const placeholders = createPlaceholders(batch.length);
      this.database
        .prepare(
          `DELETE FROM document_section_fts WHERE rowid IN (
            SELECT id FROM document_sections WHERE document_version_id IN (${placeholders})
          )`,
        )
        .run(...batch);
      const info = this.database
        .prepare(`DELETE FROM document_sections WHERE document_version_id IN (${placeholders})`)
        .run(...batch);
      deleted += info.changes;
    }
    return deleted;
  }

  private deleteVersionsByIds(versionIds: readonly number[]): number {
    let deleted = 0;
    for (const batch of chunkIds(versionIds)) {
      const info = this.database
        .prepare(`DELETE FROM document_versions WHERE id IN (${createPlaceholders(batch.length)})`)
        .run(...batch);
      deleted += info.changes;
    }
    return deleted;
  }
}

function chunkIds(ids: readonly number[]): readonly (readonly number[])[] {
  const batches: number[][] = [];
  for (let index = 0; index < ids.length; index += SQLITE_ID_BATCH_SIZE) {
    batches.push(ids.slice(index, index + SQLITE_ID_BATCH_SIZE));
  }
  return batches;
}

function createPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
