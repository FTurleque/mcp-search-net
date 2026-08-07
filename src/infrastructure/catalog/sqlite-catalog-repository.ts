import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  CatalogDocumentFilters,
  CatalogDocumentPageQuery,
  CatalogPage,
  CatalogPageQuery,
  CatalogRepository,
  CatalogSectionPageQuery,
  CatalogSourcePageQuery,
} from '../../application/ports/catalog-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentEntry,
  CatalogDocumentInput,
  CatalogDocumentObservationInput,
  CatalogDocumentRevision,
  CatalogDocumentRevisionInput,
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
  CatalogSearchIndexRebuildResult,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunStartInput,
  DocumentSection,
  DocumentSectionInput,
  DocumentVersion,
  DocumentVersionInput,
  NewCatalogSource,
} from '../../domain/models/catalog.js';
import { openCatalogDatabase } from './catalog-database.js';
import { verifyCatalogIntegrity } from './catalog-integrity.js';
import { CatalogMigrationRunner } from './catalog-migration-runner.js';
import {
  COUNT_DOCUMENT_SECTION_FTS_SQL,
  DELETE_DOCUMENT_SECTION_FTS_SQL,
  INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL,
} from './catalog-sql.js';
import { SqliteCatalogReadModel } from './sqlite-catalog-read-model.js';
import { SqliteCatalogRevisionWriter } from './sqlite-catalog-revision-writer.js';
import type { CountRow } from './sqlite-catalog-row-views.js';
import { SqliteCatalogSearch } from './sqlite-catalog-search.js';
import { SqliteCatalogSourceStore } from './sqlite-catalog-source-store.js';
import { SqliteCatalogSyncStore } from './sqlite-catalog-sync-store.js';

const MAX_PERSISTED_SECTION_CHARACTERS = 12_000;
const SECTION_CHUNK_OVERLAP_CHARACTERS = 400;

/**
 * Stable CatalogRepository facade over one SQLite connection.
 *
 * Components deliberately share this single connection so revision writes,
 * observations and FTS updates retain the original transactional boundary.
 */
export class SqliteCatalogRepository implements CatalogRepository {
  private readonly database: Database.Database;
  private readonly sources: SqliteCatalogSourceStore;
  private readonly readModel: SqliteCatalogReadModel;
  private readonly syncStore: SqliteCatalogSyncStore;
  private readonly revisions: SqliteCatalogRevisionWriter;
  private readonly search: SqliteCatalogSearch;

  public constructor(path: string, clock: Clock) {
    this.database = openCatalogDatabase(path);
    new CatalogMigrationRunner(this.database, clock).apply();
    this.sources = new SqliteCatalogSourceStore(this.database, clock);
    this.readModel = new SqliteCatalogReadModel(this.database);
    this.syncStore = new SqliteCatalogSyncStore(this.database);
    this.revisions = new SqliteCatalogRevisionWriter(this.database, clock, this.syncStore);
    this.search = new SqliteCatalogSearch(this.database);
  }

  public addSource(source: NewCatalogSource): Promise<CatalogSource> {
    return this.asPromise(() => this.sources.add(source));
  }

  public getSourceByKey(sourceKey: string): Promise<CatalogSource | undefined> {
    return this.asPromise(() => this.sources.getByKey(sourceKey));
  }

  public getSourceById(sourceId: number): Promise<CatalogSource | undefined> {
    return this.asPromise(() => this.sources.getById(sourceId));
  }

  public listSources(): Promise<readonly CatalogSource[]> {
    return this.asPromise(() => this.sources.list());
  }

  public listSourcesPage(query: CatalogSourcePageQuery): Promise<CatalogPage<CatalogSource>> {
    return this.asPromise(() => this.sources.listPage(query));
  }

  public countSources(enabled?: boolean): Promise<number> {
    return this.asPromise(() => this.sources.count(enabled));
  }

  public commitDocumentRevision(
    revision: CatalogDocumentRevisionInput,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocumentRevision> {
    const boundedRevision: CatalogDocumentRevisionInput = {
      ...revision,
      sections: chunkDocumentSections(revision.sections),
    };
    return this.asPromise(() => this.revisions.commit(boundedRevision, observation));
  }

  public upsertDocument(
    document: CatalogDocumentInput,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocument> {
    return this.asPromise(() => this.revisions.upsertDocument(document, observation));
  }

  public touchDocumentObservation(
    documentId: number,
    observation?: CatalogDocumentObservationInput,
  ): Promise<CatalogDocument> {
    return this.asPromise(() => this.revisions.touchDocumentObservation(documentId, observation));
  }

  public recordDocumentObservation(
    documentId: number,
    observation: CatalogDocumentObservationInput,
  ): Promise<void> {
    return this.asPromise(() => this.revisions.recordDocumentObservation(documentId, observation));
  }

  /** @deprecated Prefer commitDocumentRevision for atomic current revisions. */
  public addDocumentVersion(version: DocumentVersionInput): Promise<DocumentVersion> {
    return this.asPromise(() => this.revisions.addDocumentVersion(version));
  }

  /** @deprecated Prefer commitDocumentRevision for atomic current revisions. */
  public replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): Promise<readonly DocumentSection[]> {
    return this.asPromise(() =>
      this.revisions.replaceDocumentSections(documentVersionId, chunkDocumentSections(sections)),
    );
  }

  public getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined> {
    return this.asPromise(() => this.readModel.getDocumentByPublicId(publicId));
  }

  public getDocumentById(documentId: number): Promise<CatalogDocument | undefined> {
    return this.asPromise(() => this.readModel.getDocumentById(documentId));
  }

  public getCurrentDocumentVersion(documentId: number): Promise<DocumentVersion | undefined> {
    return this.asPromise(() => this.readModel.getCurrentDocumentVersion(documentId));
  }

  public listDocumentVersions(documentId: number): Promise<readonly DocumentVersion[]> {
    return this.asPromise(() => this.readModel.listDocumentVersions(documentId));
  }

  public getDocumentVersion(
    documentId: number,
    versionId: number,
  ): Promise<DocumentVersion | undefined> {
    return this.asPromise(() => this.readModel.getDocumentVersion(documentId, versionId));
  }

  public listDocumentVersionsPage(
    documentId: number,
    query: CatalogPageQuery,
  ): Promise<CatalogPage<DocumentVersion>> {
    return this.asPromise(() => this.readModel.listDocumentVersionsPage(documentId, query));
  }

  public listDocuments(): Promise<readonly CatalogDocument[]> {
    return this.asPromise(() => this.readModel.listDocuments());
  }

  public listDocumentsPage(
    query: CatalogDocumentPageQuery,
  ): Promise<CatalogPage<CatalogDocumentEntry>> {
    return this.asPromise(() => this.readModel.listDocumentsPage(query));
  }

  public countDocuments(filters: CatalogDocumentFilters = {}): Promise<number> {
    return this.asPromise(() => this.readModel.countDocuments(filters));
  }

  public listCurrentDocumentSections(): Promise<readonly CatalogCurrentDocumentSection[]> {
    return this.asPromise(() => this.readModel.listCurrentDocumentSections());
  }

  public getCurrentDocumentSectionById(
    sectionId: number,
  ): Promise<CatalogCurrentDocumentSection | undefined> {
    return this.asPromise(() => this.readModel.getCurrentDocumentSectionById(sectionId));
  }

  public listCurrentDocumentSectionsPage(
    query: CatalogSectionPageQuery,
  ): Promise<CatalogPage<CatalogCurrentDocumentSection>> {
    return this.asPromise(() => this.readModel.listCurrentDocumentSectionsPage(query));
  }

  public countCurrentDocumentSections(filters: CatalogDocumentFilters = {}): Promise<number> {
    return this.asPromise(() => this.readModel.countCurrentDocumentSections(filters));
  }

  public verifyIntegrity() {
    return this.asPromise(() => verifyCatalogIntegrity(this.database));
  }

  public rebuildSearchIndex(): Promise<CatalogSearchIndexRebuildResult> {
    return this.asPromise(() => {
      const transaction = this.database.transaction((): CatalogSearchIndexRebuildResult => {
        this.database.prepare(DELETE_DOCUMENT_SECTION_FTS_SQL).run();
        this.database.prepare(INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL).run();
        const row = this.database.prepare<[], CountRow>(COUNT_DOCUMENT_SECTION_FTS_SQL).get();
        return { indexedSections: row?.count ?? 0 };
      });
      return transaction();
    });
  }

  public startCatalogSyncRun(input: CatalogSyncRunStartInput): Promise<CatalogSyncRun> {
    return this.asPromise(() => this.syncStore.start(input));
  }

  public completeCatalogSyncRun(
    syncRunId: number,
    input: CatalogSyncRunCompletionInput,
  ): Promise<CatalogSyncRun> {
    return this.asPromise(() => this.syncStore.complete(syncRunId, input));
  }

  public searchDocuments(
    query: CatalogDocumentSearchQuery,
  ): Promise<readonly CatalogDocumentSearchResult[]> {
    return this.asPromise(() => this.search.search(query));
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private asPromise<T>(operation: () => T): Promise<T> {
    return Promise.resolve().then(operation);
  }
}

function chunkDocumentSections(
  sections: readonly DocumentSectionInput[],
): readonly DocumentSectionInput[] {
  const bounded: DocumentSectionInput[] = [];
  for (const section of sections) {
    const characters = Array.from(section.content.trim());
    if (characters.length <= MAX_PERSISTED_SECTION_CHARACTERS) {
      bounded.push(normalizeSection(section, bounded.length, characters.join(''), 1));
      continue;
    }

    const step = MAX_PERSISTED_SECTION_CHARACTERS - SECTION_CHUNK_OVERLAP_CHARACTERS;
    let part = 1;
    for (let start = 0; start < characters.length; start += step) {
      const content = characters.slice(start, start + MAX_PERSISTED_SECTION_CHARACTERS).join('').trim();
      if (content === '') continue;
      bounded.push(normalizeSection(section, bounded.length, content, part));
      part += 1;
      if (start + MAX_PERSISTED_SECTION_CHARACTERS >= characters.length) break;
    }
  }
  return bounded;
}

function normalizeSection(
  section: DocumentSectionInput,
  ordinal: number,
  content: string,
  part: number,
): DocumentSectionInput {
  const suffix = part <= 1 ? '' : `-part-${part}`;
  return {
    ...section,
    ordinal,
    ...(section.anchor === undefined ? {} : { anchor: `${section.anchor}${suffix}` }),
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
    characterCount: Array.from(content).length,
    tokenCount: content.trim().split(/\s+/u).filter(Boolean).length,
  };
}
