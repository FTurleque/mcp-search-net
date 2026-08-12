import { createHash } from 'node:crypto';

import type { CatalogRepository } from '../ports/catalog-repository.js';
import type { CacheValidators } from '../ports/cache-repository.js';
import type { Clock } from '../ports/clock.js';
import type { ContentFetchContext, ContentFetcher } from '../ports/content-fetcher.js';
import type { CatalogSyncDocumentInput } from './plan-catalog-sync.js';
import { ApplicationError, HttpError } from '../../domain/errors/domain-errors.js';
import type {
  CatalogDocument,
  CatalogDocumentAliasObservationInput,
  CatalogDocumentAliasType,
  CatalogDocumentInput,
  CatalogDocumentObservationInput,
  CatalogDocumentRevisionInput,
  CatalogStalenessEventObservationInput,
  CatalogSyncRun,
  DocumentSectionInput,
  DocumentStatus,
  DocumentVersion,
} from '../../domain/models/catalog.js';
import type { FetchedContent, NotModifiedContent } from '../../domain/models/content.js';
import {
  permanentRedirectPrefix,
  permanentRedirectTarget as redirectTargetFromChain,
} from '../../domain/services/redirect-chain.js';
import { WebUrl } from '../../domain/value-objects/web-url.js';

const CATALOG_EXTRACTION_CONTRACT_VERSION = 1;

export interface SyncCatalogResumeCursor {
  readonly sourceKey: string;
  readonly stableKey: string;
}

export interface SyncCatalogDocumentsOptions {
  readonly sourceKey?: string;
  readonly documents: readonly CatalogSyncDocumentInput[];
  readonly limit?: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly rateLimitMs?: number;
  readonly resumeAfter?: SyncCatalogResumeCursor;
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
  readonly resumeAfter?: SyncCatalogResumeCursor;
  readonly rateLimitMs: number;
  readonly limited: boolean;
}

type SyncCatalogRepository = Pick<
  CatalogRepository,
  | 'listSources'
  | 'getDocumentByPublicId'
  | 'getCurrentDocumentVersion'
  | 'upsertDocument'
  | 'touchDocumentObservation'
  | 'recordDocumentObservation'
  | 'commitDocumentRevision'
  | 'startCatalogSyncRun'
  | 'completeCatalogSyncRun'
>;

type Delay = (milliseconds: number) => Promise<void>;

export class SyncCatalogDocuments {
  public constructor(
    private readonly repository: SyncCatalogRepository,
    private readonly fetcher: ContentFetcher,
    private readonly clock: Clock,
    private readonly delay: Delay = defaultDelay,
  ) {}

  public async execute(options: SyncCatalogDocumentsOptions): Promise<SyncCatalogDocumentsOutput> {
    const startedAt = this.clock.now();
    const sources = await this.repository.listSources();
    const sourceByKey = new Map(sources.map((source) => [source.sourceKey, source]));

    if (options.sourceKey !== undefined && !sourceByKey.has(options.sourceKey)) {
      throw new Error(`Catalog source ${options.sourceKey} was not found`);
    }

    const configuredDocuments = options.documents
      .filter(
        (document) => options.sourceKey === undefined || document.sourceKey === options.sourceKey,
      )
      .filter((document) => document.enabled);
    const resumedDocuments = applyResumeCursor(configuredDocuments, options.resumeAfter);
    const selectedDocuments = applyLimit(resumedDocuments, options.limit);
    const limited =
      options.limit !== undefined && resumedDocuments.length > selectedDocuments.length;
    const continuationCursor = limited ? cursorFor(selectedDocuments.at(-1)) : options.resumeAfter;
    const rateLimitMs = normalizeRateLimit(options.rateLimitMs);
    const scopedSource =
      options.sourceKey === undefined ? undefined : sourceByKey.get(options.sourceKey);
    const runningSyncRun = await this.repository.startCatalogSyncRun({
      ...(scopedSource === undefined ? {} : { sourceId: scopedSource.id }),
      startedAt,
    });

    const entries: SyncedCatalogDocumentEntry[] = [];
    try {
      for (const document of selectedDocuments) {
        if (entries.length > 0 && rateLimitMs > 0) await this.delay(rateLimitMs);

        const source = sourceByKey.get(document.sourceKey);
        if (!source?.enabled) {
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
        let existingDocument: CatalogDocument | undefined;
        let currentVersion: DocumentVersion | undefined;
        try {
          existingDocument = await this.repository.getDocumentByPublicId(publicId);
          currentVersion = await this.getCurrentVersion(existingDocument);
          const fetched = await this.fetcher.fetch(
            {
              url: WebUrl.createTransport(document.url),
              renderMode: 'auto',
              timeoutMs: options.timeoutMs,
              maxResponseBytes: options.maxResponseBytes,
              maxRedirects: options.maxRedirects,
            },
            createFetchContext(currentVersion),
          );
          if ('notModified' in fetched) {
            if (existingDocument === undefined || currentVersion === undefined) {
              throw new Error('CATALOG_NOT_MODIFIED_WITHOUT_CURRENT_DOCUMENT');
            }
            const observation = createNotModifiedObservation(
              existingDocument,
              fetched,
              runningSyncRun.id,
            );
            const redirectTarget = normalizedPermanentRedirectTarget(fetched.redirectChain);
            const storedDocument =
              redirectTarget !== undefined &&
              (existingDocument.canonicalUrl !== redirectTarget ||
                existingDocument.status !== 'REDIRECTED')
                ? await this.repository.upsertDocument(
                    {
                      publicId: existingDocument.publicId,
                      sourceId: existingDocument.sourceId,
                      canonicalUrl: redirectTarget,
                      stableKey: existingDocument.stableKey,
                      title: existingDocument.title,
                      mimeType: existingDocument.mimeType,
                      language: existingDocument.language,
                      status: 'REDIRECTED',
                    },
                    observation,
                  )
                : await this.repository.touchDocumentObservation(existingDocument.id, observation);
            entries.push({
              sourceKey: document.sourceKey,
              stableKey: document.stableKey,
              title: document.title,
              url: document.url,
              status: 'unchanged',
              document: storedDocument,
            });
            continue;
          }

          const documentInput = {
            publicId,
            sourceId: source.id,
            canonicalUrl: fetched.canonicalUrl,
            stableKey: document.stableKey,
            title: fetched.title ?? document.title,
            mimeType: document.mimeType,
            language: document.language,
            status: documentStatusFor(fetched),
          } as const;
          const observation = createFetchedDocumentObservation(
            existingDocument,
            currentVersion,
            fetched,
            runningSyncRun.id,
          );
          const revisionInput = createCatalogRevisionInput(
            documentInput,
            document.sourceKey,
            fetched.title ?? document.title,
            fetched,
          );

          if (currentVersion?.contentHash === fetched.contentHash) {
            // A 200 with identical upstream bytes is still authoritative for representation
            // metadata and extraction. Re-upserting the same version keeps its identity and version
            // count stable while atomically refreshing validators, metadata, sections and FTS.
            const revision = await this.repository.commitDocumentRevision(revisionInput, observation);
            entries.push({
              sourceKey: document.sourceKey,
              stableKey: document.stableKey,
              title: fetched.title ?? document.title,
              url: document.url,
              status: 'unchanged',
              document: revision.document,
              sectionCount: revision.sections.length,
            });
            continue;
          }

          const revision = await this.repository.commitDocumentRevision(revisionInput, observation);
          entries.push({
            sourceKey: document.sourceKey,
            stableKey: document.stableKey,
            title: fetched.title ?? document.title,
            url: document.url,
            status: existingDocument === undefined ? 'added' : 'updated',
            document: revision.document,
            sectionCount: revision.sections.length,
          });
        } catch (error) {
          if (isMissingRemoteHttpError(error) && existingDocument !== undefined) {
            const missingStatus = documentStatusForMissingRemote(error);
            const staleDocument = await this.repository.upsertDocument(
              {
                publicId,
                sourceId: source.id,
                canonicalUrl: existingDocument.canonicalUrl,
                stableKey: document.stableKey,
                title: existingDocument.title,
                mimeType: existingDocument.mimeType,
                language: existingDocument.language,
                status: missingStatus,
              },
              createHttpMissingObservation(error.status, document.url, runningSyncRun.id),
            );
            entries.push({
              sourceKey: document.sourceKey,
              stableKey: document.stableKey,
              title: existingDocument.title,
              url: document.url,
              status: 'updated',
              document: staleDocument,
              error: `HTTP_${error.status}_${missingStatus}`,
            });
            continue;
          }

          if (existingDocument !== undefined && isSourceUnavailable(error)) {
            await this.repository.recordDocumentObservation(
              existingDocument.id,
              createSourceUnavailableObservation(error, runningSyncRun.id),
            );
          }
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
    } catch (error) {
      const counts = countSyncEntries(entries);
      await this.repository.completeCatalogSyncRun(runningSyncRun.id, {
        completedAt: this.clock.now(),
        status: 'FAILED',
        documentsChecked: counts.checkedCount,
        documentsAdded: counts.addedCount,
        documentsUpdated: counts.updatedCount,
        documentsUnchanged: counts.unchangedCount,
        documentsFailed: counts.failedCount,
        errorSummary: 'Synchronization aborted before completion',
      });
      throw error;
    }

    const { addedCount, updatedCount, unchangedCount, failedCount, skippedCount, checkedCount } =
      countSyncEntries(entries);
    const syncRun = await this.repository.completeCatalogSyncRun(runningSyncRun.id, {
      completedAt: this.clock.now(),
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
      ...(continuationCursor === undefined ? {} : { resumeAfter: continuationCursor }),
      rateLimitMs,
      limited,
    };
  }

  private async getCurrentVersion(
    document: CatalogDocument | undefined,
  ): Promise<DocumentVersion | undefined> {
    if (document === undefined) return undefined;
    if (this.repository.getCurrentDocumentVersion === undefined) return undefined;
    return this.repository.getCurrentDocumentVersion(document.id);
  }
}

function applyResumeCursor(
  documents: readonly CatalogSyncDocumentInput[],
  cursor: SyncCatalogResumeCursor | undefined,
): readonly CatalogSyncDocumentInput[] {
  if (cursor === undefined) return documents;
  const index = documents.findIndex(
    (document) =>
      document.sourceKey === cursor.sourceKey && document.stableKey === cursor.stableKey,
  );
  if (index === -1) {
    throw new Error(`Resume cursor ${cursor.sourceKey}:${cursor.stableKey} was not found`);
  }
  return documents.slice(index + 1);
}

function applyLimit(
  documents: readonly CatalogSyncDocumentInput[],
  limit: number | undefined,
): readonly CatalogSyncDocumentInput[] {
  return limit === undefined ? documents : documents.slice(0, limit);
}

function cursorFor(
  document: CatalogSyncDocumentInput | undefined,
): SyncCatalogResumeCursor | undefined {
  return document === undefined
    ? undefined
    : { sourceKey: document.sourceKey, stableKey: document.stableKey };
}

function normalizeRateLimit(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function createFetchContext(version: DocumentVersion | undefined): ContentFetchContext | undefined {
  if (version === undefined) return undefined;
  const cacheValidators = createCacheValidators(version);
  return Object.keys(cacheValidators).length === 0 ? undefined : { cacheValidators };
}

function createCacheValidators(version: DocumentVersion): CacheValidators {
  const contractIsCurrent =
    versionExtractionContractVersion(version) === CATALOG_EXTRACTION_CONTRACT_VERSION;
  const validatorUrl = contractIsCurrent ? versionValidatorUrl(version) : undefined;
  return {
    contentHash: version.contentHash,
    ...(contractIsCurrent && version.etag !== undefined ? { etag: version.etag } : {}),
    ...(contractIsCurrent && version.lastModified !== undefined
      ? { lastModified: version.lastModified }
      : {}),
    ...(validatorUrl === undefined ? {} : { validatorUrl }),
  };
}

function versionValidatorUrl(version: DocumentVersion): string | undefined {
  if (version.etag === undefined && version.lastModified === undefined) return undefined;
  const metadata = versionMetadata(version);
  if (metadata === undefined) return undefined;
  const finalUrl = metadata['finalUrl'];
  return typeof finalUrl === 'string' ? WebUrl.createTransport(finalUrl).value : undefined;
}

function versionExtractionContractVersion(version: DocumentVersion): number {
  const metadata = versionMetadata(version);
  const value = metadata?.['extractionContractVersion'];
  // Versions written before this field existed used the current V1 extraction contract.
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function versionMetadata(version: DocumentVersion): Readonly<Record<string, unknown>> | undefined {
  try {
    const metadata = JSON.parse(version.metadataJson) as unknown;
    return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}

interface SyncEntryCounts {
  readonly addedCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly checkedCount: number;
}

function countSyncEntries(entries: readonly SyncedCatalogDocumentEntry[]): SyncEntryCounts {
  const addedCount = entries.filter((entry) => entry.status === 'added').length;
  const updatedCount = entries.filter((entry) => entry.status === 'updated').length;
  const unchangedCount = entries.filter((entry) => entry.status === 'unchanged').length;
  const failedCount = entries.filter((entry) => entry.status === 'failed').length;
  const skippedCount = entries.filter((entry) => entry.status === 'skipped').length;
  return {
    addedCount,
    updatedCount,
    unchangedCount,
    failedCount,
    skippedCount,
    checkedCount: addedCount + updatedCount + unchangedCount + failedCount,
  };
}

function createFetchedDocumentObservation(
  existingDocument: CatalogDocument | undefined,
  currentVersion: DocumentVersion | undefined,
  fetched: FetchedContent,
  syncRunId: number,
): CatalogDocumentObservationInput {
  const permanentRedirects = permanentRedirectPrefix(fetched.redirectChain);
  const aliases = collectAliases(fetched.canonicalUrl, [
    ...(existingDocument === undefined || existingDocument.canonicalUrl === fetched.canonicalUrl
      ? []
      : [{ url: existingDocument.canonicalUrl, aliasType: 'OLD_URL' as const }]),
    ...permanentRedirects.map((redirect) => ({
      url: redirect.fromUrl,
      aliasType: 'REDIRECT' as const,
    })),
    ...(fetched.finalUrl === fetched.canonicalUrl
      ? []
      : [{ url: fetched.finalUrl, aliasType: 'CANONICAL' as const }]),
  ]);
  const events: CatalogStalenessEventObservationInput[] = [];
  if (permanentRedirects.length > 0) {
    events.push(
      createEvent('PERMANENT_REDIRECT', {
        redirectChain: permanentRedirects,
      }),
    );
  }
  if (existingDocument !== undefined && existingDocument.canonicalUrl !== fetched.canonicalUrl) {
    events.push(
      createEvent('CANONICAL_CHANGED', {
        previousCanonicalUrl: existingDocument.canonicalUrl,
        canonicalUrl: fetched.canonicalUrl,
      }),
    );
  }
  if (currentVersion !== undefined && currentVersion.contentHash !== fetched.contentHash) {
    events.push(
      createEvent('CONTENT_HASH_CHANGED', {
        previousContentHash: currentVersion.contentHash,
        contentHash: fetched.contentHash,
      }),
    );
  }
  return { syncRunId, aliases, events };
}

function createNotModifiedObservation(
  existingDocument: CatalogDocument,
  fetched: NotModifiedContent,
  syncRunId: number,
): CatalogDocumentObservationInput {
  const permanentRedirects = permanentRedirectPrefix(fetched.redirectChain);
  const redirectTarget = normalizedPermanentRedirectTarget(fetched.redirectChain);
  const aliases = collectAliases(redirectTarget ?? existingDocument.canonicalUrl, [
    ...(redirectTarget === undefined || redirectTarget === existingDocument.canonicalUrl
      ? []
      : [{ url: existingDocument.canonicalUrl, aliasType: 'OLD_URL' as const }]),
    ...permanentRedirects.map((redirect) => ({
      url: redirect.fromUrl,
      aliasType: 'REDIRECT' as const,
    })),
  ]);
  const events: CatalogStalenessEventObservationInput[] = [];
  if (permanentRedirects.length > 0) {
    events.push(createEvent('PERMANENT_REDIRECT', { redirectChain: permanentRedirects }));
  }
  if (redirectTarget !== undefined && redirectTarget !== existingDocument.canonicalUrl) {
    events.push(
      createEvent('CANONICAL_CHANGED', {
        previousCanonicalUrl: existingDocument.canonicalUrl,
        canonicalUrl: redirectTarget,
      }),
    );
  }
  const currentVersionValidators = {
    ...(fetched.etag === undefined ? {} : { etag: fetched.etag }),
    ...(fetched.lastModified === undefined ? {} : { lastModified: fetched.lastModified }),
  };
  return {
    syncRunId,
    aliases,
    events,
    ...(Object.keys(currentVersionValidators).length === 0 ? {} : { currentVersionValidators }),
  };
}

function createCatalogRevisionInput(
  document: CatalogDocumentInput,
  sourceKey: string,
  title: string,
  fetched: FetchedContent,
): CatalogDocumentRevisionInput {
  const redirectMetadata = createRedirectVersionMetadata(fetched);
  return {
    document,
    version: {
      contentHash: fetched.contentHash,
      ...(fetched.etag === undefined ? {} : { etag: fetched.etag }),
      ...(fetched.lastModified === undefined ? {} : { lastModified: fetched.lastModified }),
      publishedAt: new Date(fetched.fetchedAt),
      extractionMode: fetched.extractionMode,
      contentType: fetched.contentType,
      metadataJson: JSON.stringify({
        ingestion: 'catalog-sync',
        sourceKey,
        requestedUrl: fetched.requestedUrl,
        finalUrl: fetched.finalUrl,
        statusCode: fetched.statusCode,
        extractionContractVersion: CATALOG_EXTRACTION_CONTRACT_VERSION,
        ...redirectMetadata,
      }),
    },
    sections: createSections(title, fetched),
  };
}

function createHttpMissingObservation(
  status: 404 | 410,
  requestedUrl: string,
  syncRunId: number,
): CatalogDocumentObservationInput {
  return {
    syncRunId,
    events: [createEvent(status === 404 ? 'HTTP_404' : 'HTTP_410', { status, requestedUrl })],
  };
}

function createSourceUnavailableObservation(
  error: ApplicationError,
  syncRunId: number,
): CatalogDocumentObservationInput {
  return {
    syncRunId,
    events: [
      createEvent('SOURCE_UNAVAILABLE', {
        code: error.code,
        ...(error instanceof HttpError && error.status !== undefined
          ? { status: error.status }
          : {}),
      }),
    ],
  };
}

function createEvent(
  eventType: CatalogStalenessEventObservationInput['eventType'],
  details: Readonly<Record<string, unknown>>,
): CatalogStalenessEventObservationInput {
  return { eventType, detailsJson: JSON.stringify(details) };
}

const ALIAS_TYPE_PRIORITY: Readonly<Record<CatalogDocumentAliasType, number>> = {
  CANONICAL: 1,
  OLD_URL: 2,
  REDIRECT: 3,
};

function collectAliases(
  canonicalUrl: string,
  candidates: readonly CatalogDocumentAliasObservationInput[],
): readonly CatalogDocumentAliasObservationInput[] {
  const normalizedCanonical = WebUrl.tryCreate(canonicalUrl)?.value ?? canonicalUrl;
  const aliases = new Map<string, CatalogDocumentAliasObservationInput>();
  for (const candidate of candidates) {
    const url = WebUrl.tryCreate(candidate.url)?.value;
    if (url === undefined || url === normalizedCanonical) continue;
    const existing = aliases.get(url);
    if (
      existing === undefined ||
      ALIAS_TYPE_PRIORITY[candidate.aliasType] > ALIAS_TYPE_PRIORITY[existing.aliasType]
    ) {
      aliases.set(url, { url, aliasType: candidate.aliasType });
    }
  }
  return [...aliases.values()];
}

function documentStatusFor(fetched: FetchedContent): DocumentStatus {
  return normalizedPermanentRedirectTarget(fetched.redirectChain) === undefined
    ? 'ACTIVE'
    : 'REDIRECTED';
}

function normalizedPermanentRedirectTarget(
  redirectChain: NotModifiedContent['redirectChain'],
): string | undefined {
  const target = redirectTargetFromChain(redirectChain);
  if (target === undefined) return undefined;
  try {
    return WebUrl.createTransport(target).value;
  } catch {
    return undefined;
  }
}

function createRedirectVersionMetadata(fetched: FetchedContent): Readonly<Record<string, unknown>> {
  const permanentTarget = normalizedPermanentRedirectTarget(fetched.redirectChain);
  return fetched.redirectChain.length === 0
    ? {}
    : {
        redirectChain: fetched.redirectChain,
        ...(permanentTarget === undefined ? {} : { redirectedPermanently: true }),
      };
}

function isMissingRemoteHttpError(
  error: unknown,
): error is HttpError & { readonly status: 404 | 410 } {
  return error instanceof HttpError && (error.status === 404 || error.status === 410);
}

function documentStatusForMissingRemote(
  error: HttpError & { readonly status: 404 | 410 },
): DocumentStatus {
  return error.status === 410 ? 'REMOVED' : 'STALE';
}

function isSourceUnavailable(error: unknown): error is ApplicationError {
  if (!(error instanceof ApplicationError)) return false;
  if (error.code === 'CONTENT_PROVIDER_UNAVAILABLE' || error.code === 'REQUEST_TIMEOUT')
    return true;
  return (
    error instanceof HttpError &&
    (error.status === undefined ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

function createSections(title: string, fetched: FetchedContent): readonly DocumentSectionInput[] {
  const extracted = fetched.documentSections.filter(
    (section) => section.markdown.trim().length > 0,
  );
  const sections =
    extracted.length === 0 ? [{ heading: title, markdown: fetched.markdown }] : extracted;
  return sections.map((section, index) =>
    createSection(index, title, section.heading, section.markdown),
  );
}

function createSection(
  ordinal: number,
  documentTitle: string,
  heading: string,
  markdown: string,
): DocumentSectionInput {
  const content = markdown.trim();
  const normalizedHeading = heading.trim() || documentTitle;
  return {
    ordinal,
    heading: normalizedHeading,
    headingPath: normalizedHeading,
    headingLevel: 1,
    anchor: slugify(normalizedHeading),
    content,
    contentHash: sha256(content),
    characterCount: Array.from(content).length,
    tokenCount: estimateTokenCount(content),
  };
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

function estimateTokenCount(content: string): number {
  return content.trim().split(/\s+/u).filter(Boolean).length;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
