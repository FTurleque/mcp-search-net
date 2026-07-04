import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { CatalogRepository } from '../application/ports/catalog-repository.js';
import type {
  CatalogDocument,
  DocumentSection,
  DocumentSectionInput,
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

interface MarkdownHeading {
  readonly lineIndex: number;
  readonly level: number;
  readonly title: string;
  readonly anchor: string;
  readonly headingPath: string;
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
  const sections = await repository.replaceDocumentSections(
    version.id,
    splitMarkdownSections(options.title, content),
  );

  return {
    schemaVersion: '1.0',
    document,
    version,
    sectionCount: sections.length,
    contentHash,
  };
}

export function splitMarkdownSections(
  title: string,
  content: string,
): readonly DocumentSectionInput[] {
  const lines = content.split(/\r?\n/u);
  const headings = findHeadings(lines);
  if (headings.length === 0) {
    return [createSection(0, title, title, 1, 'document', content)];
  }

  return headings.map((heading, index) => {
    const nextHeading = headings[index + 1];
    const sectionContent = lines
      .slice(heading.lineIndex, nextHeading?.lineIndex ?? lines.length)
      .join('\n')
      .trim();
    return createSection(
      index,
      heading.title,
      heading.headingPath,
      heading.level,
      heading.anchor,
      sectionContent,
    );
  });
}

function findHeadings(lines: readonly string[]): readonly MarkdownHeading[] {
  const stack: string[] = [];
  return lines.flatMap((line, lineIndex): MarkdownHeading[] => {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line.trim());
    if (match === null) return [];

    const level = match[1]?.length ?? 1;
    const title = (match[2] ?? '').trim();
    stack.splice(level - 1, stack.length, title);
    return [
      {
        lineIndex,
        level,
        title,
        anchor: slugify(title),
        headingPath: stack.slice(0, level).join(' > '),
      },
    ];
  });
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
