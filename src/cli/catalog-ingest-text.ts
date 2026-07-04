import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { CatalogRepository } from '../application/ports/catalog-repository.js';
import type {
  CatalogDocument,
  DocumentSection,
  DocumentVersion,
} from '../domain/models/catalog.js';

export interface IngestTextDocumentOptions {
  readonly sourceKey: string;
  readonly filePath: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly language: string;
  readonly mimeType: string;
  readonly stableKey?: string;
  readonly versionLabel?: string;
}

export interface IngestTextDocumentResult {
  readonly schemaVersion: '1.0';
  readonly document: CatalogDocument;
  readonly version: DocumentVersion;
  readonly sectionCount: number;
  readonly contentHash: string;
}

export async function ingestTextDocument(
  repository: CatalogRepository,
  options: IngestTextDocumentOptions,
): Promise<IngestTextDocumentResult> {
  const source = await repository.getSourceByKey(options.sourceKey);
  if (source === undefined) throw new Error(`Unknown catalog source ${options.sourceKey}`);

  const content = await readFile(options.filePath, 'utf8');
  const contentHash = sha256(content);
  const stableKey = options.stableKey ?? stableKeyFromUrl(options.canonicalUrl);
  const document = await repository.upsertDocument({
    publicId: publicDocumentId(options.sourceKey, stableKey),
    sourceId: source.id,
    canonicalUrl: options.canonicalUrl,
    stableKey,
    title: options.title,
    mimeType: options.mimeType,
    language: options.language,
    status: 'ACTIVE',
  });
  const version = await repository.addDocumentVersion({
    documentId: document.id,
    ...(options.versionLabel === undefined ? {} : { versionLabel: options.versionLabel }),
    contentHash,
    isCurrent: true,
    extractionMode: 'static',
    contentType: options.mimeType,
    metadataJson: JSON.stringify({ ingestion: 'cli', sourceKey: options.sourceKey }),
  });
  const sections = await replaceSingleSection(
    repository,
    version.id,
    options.title,
    content,
    contentHash,
  );

  return {
    schemaVersion: '1.0',
    document,
    version,
    sectionCount: sections.length,
    contentHash,
  };
}

async function replaceSingleSection(
  repository: CatalogRepository,
  documentVersionId: number,
  title: string,
  content: string,
  contentHash: string,
): Promise<readonly DocumentSection[]> {
  return repository.replaceDocumentSections(documentVersionId, [
    {
      ordinal: 0,
      heading: title,
      headingPath: title,
      headingLevel: 1,
      anchor: 'cli-text',
      content,
      contentHash,
      characterCount: Array.from(content).length,
    },
  ]);
}

function stableKeyFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\/+|\/+$/gu, '') || 'index';
}

function publicDocumentId(sourceKey: string, stableKey: string): string {
  return `doc_${sha256(`${sourceKey}:${stableKey}`).slice(0, 24)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
