import type { CatalogRepository } from '../ports/catalog-repository.js';
import type {
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
} from '../../domain/models/catalog.js';
import {
  MAX_EXTERNAL_ANCHOR_CHARACTERS,
  MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
  MAX_EXTERNAL_SOURCE_NAME_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';

export interface SearchCatalogDocumentsInput {
  readonly query: string;
  readonly sourceKey?: string;
  readonly language?: string;
  readonly limit?: number;
}

export interface SearchCatalogDocumentsOutput {
  readonly schemaVersion: '1.0';
  readonly query: string;
  readonly resultCount: number;
  readonly results: readonly SearchCatalogDocumentsItem[];
}

export interface SearchCatalogDocumentsItem {
  readonly sourceKey: string;
  readonly sourceName: string;
  readonly documentPublicId: string;
  readonly sectionId: number;
  readonly title: string;
  readonly url: string;
  readonly language: string;
  readonly heading?: string;
  readonly headingPath?: string;
  readonly anchor?: string;
  readonly snippet: string;
  readonly score: number;
}

export class SearchCatalogDocuments {
  public constructor(private readonly repository: Pick<CatalogRepository, 'searchDocuments'>) {}

  public async execute(input: SearchCatalogDocumentsInput): Promise<SearchCatalogDocumentsOutput> {
    const query = input.query.trim();
    if (query.length === 0) throw new Error('Catalog search query must not be empty');

    const searchQuery: CatalogDocumentSearchQuery = {
      query,
      ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    };
    const results = await this.repository.searchDocuments(searchQuery);

    return {
      schemaVersion: '1.0',
      query,
      resultCount: results.length,
      results: results.map(toOutputItem),
    };
  }
}

function toOutputItem(result: CatalogDocumentSearchResult): SearchCatalogDocumentsItem {
  const sourceKey = boundedNonEmpty(
    result.source.sourceKey,
    MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
    'catalog',
  );
  const publicId = boundedNonEmpty(
    result.document.publicId,
    MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
    `document-${result.document.id}`,
  );
  return {
    sourceKey,
    sourceName: boundedNonEmpty(
      result.source.displayName,
      MAX_EXTERNAL_SOURCE_NAME_CHARACTERS,
      sourceKey,
    ),
    documentPublicId: publicId,
    sectionId: result.section.id,
    title: boundedNonEmpty(result.document.title, MAX_EXTERNAL_TITLE_CHARACTERS, publicId),
    url: result.document.canonicalUrl,
    language: boundedNonEmpty(result.document.language, MAX_EXTERNAL_LANGUAGE_CHARACTERS, 'und'),
    ...(result.section.heading === undefined
      ? {}
      : { heading: truncateUnicode(result.section.heading, MAX_EXTERNAL_HEADING_CHARACTERS) }),
    ...(result.section.headingPath === undefined
      ? {}
      : {
          headingPath: truncateUnicode(
            result.section.headingPath,
            MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
          ),
        }),
    ...(result.section.anchor === undefined
      ? {}
      : { anchor: truncateUnicode(result.section.anchor, MAX_EXTERNAL_ANCHOR_CHARACTERS) }),
    snippet: result.snippet,
    score: result.score,
  };
}

function boundedNonEmpty(value: string, maximumCharacters: number, fallback: string): string {
  const trimmed = value.trim();
  return truncateUnicode(trimmed === '' ? fallback : trimmed, maximumCharacters);
}
