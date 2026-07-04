import { createHash } from 'node:crypto';

import type { ContentFetcher } from '../ports/content-fetcher.js';
import type { CatalogRepository } from '../ports/catalog-repository.js';
import type { Clock } from '../ports/clock.js';
import type { CatalogSyncDocumentInput } from './plan-catalog-sync.js';
import type {
  CatalogDocument,
  CatalogSyncRun,
  DocumentSectionInput,
} from '../../domain/models/catalog.js';
import { WebUrl } from '../../domain/value-objects/web-url.js';

export interface SyncCatalogDocumentsOptions {
  readonly sourceKey?: string;
  readonly documents: readonly CatalogSyncDocumentInput[];
  readonly limit: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
}

export type SyncedCatalogDocumentStatus = 'added' | 'updated' | 'unchanged' | 'failed' | 'skipped';

export interface SyncedCatalogDocumentEntry {
  readonly sourceKey: string;
  readonly stableKey: string;
  readonly title: string;
  readonly url: string;
  readonly status: SyncedCatalogDocumentStatus;
  readonly document?: CatalogDocument;
  readonly sectionCount?: number;
  readonly error?: string;
}

export interface SyncCatalogDocumentsOutput {
  readonly schemaVersion: '1.0';
  readonly dryRun: false;
  readonly syncRun: CatalogSyncRun;
  readonly checkedCount: number;
  readonly addedCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly documents: readonly SyncedCatalogDocumentEntry[];
}

export class SyncCatalogDocuments {
  public constructor(
    private readonly repository: Pick<
      CatalogRepository,
      | 'listSources'
      | 'getDocumentByPublicId'
      | 'upsertDocument'
      | 'addDocumentVersion'
      | 'replaceDocumentSections'
      | 'addCatalogSyncRun'
    >,
    private readonly fetcher: ContentFetcher,
    private readonly clock: Clock,
  ) {}

  public async execute(options: SyncCatalogDocumentsOptions): Promise<SyncCatalogDocumentsOutput> {
    const sources = await this.repository.listSources();
    const sourceByKey = new Map(sources.map((source) => [source.sourceKey, source]));
    const selectedDocuments = options.documents
      .filter((document) => options.sourceKey === undefined || document.sourceKey === options.sourceKey)
      .filter((document) => document.enabled)
      .slice(0, options.limit);

    if (options.sourceKey !== undefined && !sourceByKey.has(options.sourceKey)) {
      throw new Error(`Catalog source ${options.sourceKey} was not found`);
    }

    const entries: SyncedCatalogDocumentEntry[] = [];
    for (const document of selectedDocuments) {
      const source = sourceByKey.get(document.sourceKey);
      if (source === undefined || !source.enabled) {
        entries.push({
          sourceKey: document.sourceKey,
          stableKey: document.stableKey,
          title: document.title,
          url: document.url,
          status: 'skipped',
          error: source === undefined ? 'SOURCE_NOT_FOUND' : 'SOURCE_DISABLED',
        });
        continue;
      }

      const publicId = publicDocumentId(document.sourceKey, document.stableKey);
      const existingDocument = await this.repository.getDocumentByPublicId(publicId);
      try {
        const fetched = await this.fetcher.fetch({
          url: WebUrl.create(document.url),
          renderMode: 'auto',
          timeoutMs: options.timeoutMs,
          maxResponseBytes: options.maxResponseBytes,
          maxRedirects: options.maxRedirects,
        });
        if ('notModified' in fetched) {
          entries.push({
            sourceKey: document.sourceKey,
            stableKey: document.stableKey,
            title: document.title,
            url: document.url,
            status: 'unchanged',
            ...(existingDocument === undefined ? {} : { document: existingDocument }),
          });
          continue;
        }

        const storedDocument = await this.repository.upsertDocument({
          publicId,
          sourceId: source.id,
          canonicalUrl: fetched.canonicalUrl,
          stableKey: document.stableKey,
          title: fetched.title ?? document.title,
          mimeType: document.mimeType,
          language: document.language,
          status: 'ACTIVE',
        });
        const version = await this.repository.addDocumentVersion({
          documentId: storedDocument.id,
          contentHash: fetched.contentHash,
          ...(fetched.etag === undefined ? {} : { etag: fetched.etag }),
          ...(fetched.lastModified === undefined ? {} : { lastModified: fetched.lastModified }),
          publishedAt: new Date(fetched.fetchedAt),
          isCurrent: true,
          extractionMode: fetched.extractionMode,
          contentType: fetched.contentType,
          metadataJson: JSON.stringify({
            ingestion: 'catalog-sync',
            sourceKey: document.sourceKey,
            requestedUrl: fetched.requestedUrl,
            finalUrl: fetched.finalUrl,
            statusCode: fetched.statusCode,
          }),
        });
        const sections = await this.repository.replaceDocumentSections(
          version.id,
          createSections(fetched.title ?? document.title, fetched.markdown),
        );
        entries.push({
          sourceKey: document.sourceKey,
          stableKey: document.stableKey,
          title: fetched.title ?? document.title,
          url: document.url,
          status: existingDocument === undefined ? 'added' : 'updated',
          document: storedDocument,
          sectionCount: sections.length,
        });
      } catch (error) {
        entries.push({
          sourceKey: document.sourceKey,
          stableKey: document.stableKey,
          title: document.title,
          url: document.url,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const addedCount = entries.filter((entry) => entry.status === 'added').length;
    const updatedCount = entries.filter((entry) => entry.status === 'updated').length;
    const unchangedCount = entries.filter((entry) => entry.status === 'unchanged').length;
    const failedCount = entries.filter((entry) => entry.status === 'failed').length;
    const skippedCount = entries.filter((entry) => entry.status === 'skipped').length;
    const checkedCount = addedCount + updatedCount + unchangedCount + failedCount;
    const now = this.clock.now();
    const scopedSource = options.sourceKey === undefined ? undefined : sourceByKey.get(options.sourceKey);
    const syncRun = await this.repository.addCatalogSyncRun({
      ...(scopedSource === undefined ? {} : { sourceId: scopedSource.id }),
      startedAt: now,
      completedAt: now,
      status: failedCount === 0 ? 'SUCCESS' : checkedCount === failedCount ? 'FAILED' : 'PARTIAL',
      documentsChecked: checkedCount,
      documentsAdded: addedCount,
      documentsUpdated: updatedCount,
      documentsUnchanged: unchangedCount,
      documentsFailed: failedCount,
      ...(failedCount === 0 ? {} : { errorSummary: `${failedCount} document(s) failed` }),
    });

    return {
      schemaVersion: '1.0',
      dryRun: false,
      syncRun,
      checkedCount,
      addedCount,
      updatedCount,
      unchangedCount,
      failedCount,
      skippedCount,
      documents: entries,
    };
  }
}

function createSections(title: string, markdown: string): readonly DocumentSectionInput[] {
  const content = markdown.trim();
  return [
    {
      ordinal: 0,
      heading: title,
      headingPath: title,
      headingLevel: 1,
      anchor: slugify(title),
      content,
      contentHash: sha256(content),
      characterCount: Array.from(content).length,
      tokenCount: content.split(/\s+/u).filter(Boolean).length,
    },
  ];
}

function publicDocumentId(sourceKey: string, stableKey: string): string {
  return `doc_${sha256(`${sourceKey}:${stableKey}`).slice(0, 24)}`;
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'document'
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
