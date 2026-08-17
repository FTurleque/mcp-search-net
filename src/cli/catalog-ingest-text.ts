import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';

import type { CatalogRepository } from '../application/ports/catalog-repository.js';
import type {
  CatalogDocument,
  DocumentSectionInput,
  DocumentVersion,
} from '../domain/models/catalog.js';
import { scanMarkdownHeadings } from '../domain/services/markdown-structure.js';
import { WebUrl } from '../domain/value-objects/web-url.js';

const MAX_INGEST_TEXT_BYTES = 16 * 1024 * 1024;
const INGEST_TEXT_READ_CHUNK_BYTES = 64 * 1024;

type OpenTextFile = (filePath: string) => Promise<FileHandle>;

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

  const content = await readBoundedTextFile(options.filePath);
  const canonicalUrl = WebUrl.createTransport(options.canonicalUrl).value;
  const contentHash = sha256(content);
  const stableKey = options.stableKey ?? stableKeyFromUrl(canonicalUrl);
  const revision = await repository.commitDocumentRevision({
    document: {
      publicId: publicDocumentId(options.sourceKey, stableKey),
      sourceId: source.id,
      canonicalUrl,
      stableKey,
      title: options.title,
      mimeType: options.mimeType,
      language: options.language,
      status: 'ACTIVE',
    },
    version: {
      ...(options.versionLabel === undefined ? {} : { versionLabel: options.versionLabel }),
      contentHash,
      extractionMode: 'static',
      contentType: options.mimeType,
      metadataJson: JSON.stringify({ ingestion: 'cli', sourceKey: options.sourceKey }),
    },
    sections: splitMarkdownSections(options.title, content),
  });

  return {
    schemaVersion: '1.0',
    document: revision.document,
    version: revision.version,
    sectionCount: revision.sections.length,
    contentHash,
  };
}

export async function readBoundedTextFile(
  filePath: string,
  openFile: OpenTextFile = openTextFile,
): Promise<string> {
  const handle = await openFile(filePath);
  try {
    // Keep metadata validation and reads on the same descriptor so replacing the pathname cannot
    // swap in a different file between stat and read. The read loop is independently bounded so a
    // file that grows after fstat still cannot exceed the ingestion memory budget.
    const file = await handle.stat();
    if (!file.isFile()) throw new Error('CATALOG_INGEST_INPUT_NOT_FILE');
    if (file.size > MAX_INGEST_TEXT_BYTES) throw ingestFileTooLarge(file.size);

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for (;;) {
      const remainingBudget = MAX_INGEST_TEXT_BYTES + 1 - totalBytes;
      if (remainingBudget <= 0) throw ingestFileTooLarge(totalBytes);
      const chunk = Buffer.alloc(Math.min(INGEST_TEXT_READ_CHUNK_BYTES, remainingBudget));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;

      totalBytes += bytesRead;
      if (totalBytes > MAX_INGEST_TEXT_BYTES) {
        throw ingestFileTooLarge(Math.max(file.size, totalBytes));
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } finally {
    await handle.close();
  }
}

export function splitMarkdownSections(
  title: string,
  content: string,
): readonly DocumentSectionInput[] {
  const lines = content.split(/\r?\n/u);
  const headings = scanMarkdownHeadings(lines);
  if (headings.length === 0) {
    return [createSection(0, title, title, 1, 'document', content)];
  }

  const sections: DocumentSectionInput[] = [];
  const firstHeading = headings[0];
  if (firstHeading !== undefined) {
    const preamble = lines.slice(0, firstHeading.lineIndex).join('\n').trim();
    if (preamble !== '') {
      sections.push(createSection(0, title, title, 1, 'document', preamble));
    }
  }

  sections.push(
    ...headings.map((heading, index) => {
      const nextHeading = headings[index + 1];
      const sectionContent = lines
        .slice(heading.lineIndex, nextHeading?.lineIndex ?? lines.length)
        .join('\n')
        .trim();
      return createSection(
        sections.length + index,
        heading.title,
        heading.headingPath,
        heading.level,
        slugify(heading.title),
        sectionContent,
      );
    }),
  );
  return sections;
}

function openTextFile(filePath: string): Promise<FileHandle> {
  return open(filePath, 'r');
}

function ingestFileTooLarge(size: number): Error {
  return new Error(`CATALOG_INGEST_FILE_TOO_LARGE:${size}:${MAX_INGEST_TEXT_BYTES}`);
}

function createSection(
  ordinal: number,
  heading: string,
  headingPath: string,
  headingLevel: number,
  anchor: string,
  content: string,
): DocumentSectionInput {
  return {
    ordinal,
    heading,
    headingPath,
    headingLevel,
    anchor,
    content,
    contentHash: sha256(content),
    characterCount: Array.from(content).length,
    tokenCount: estimateTokenCount(content),
  };
}

function stableKeyFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\/+|\/+$/gu, '') || 'index';
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
      .replace(/^-+|-+$/gu, '') || 'section'
  );
}

function estimateTokenCount(content: string): number {
  const tokens = content.trim().split(/\s+/u).filter(Boolean);
  return tokens.length;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
