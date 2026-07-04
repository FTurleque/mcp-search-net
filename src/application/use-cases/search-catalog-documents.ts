import type { CatalogRepository } from '../ports/catalog-repository.js';
import type {
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
} from '../../domain/models/catalog.js';

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
  public constructor(
    private readonly repository: Pick<CatalogRepository, 'searchDocuments'>,
  ) {}

  public async execute(
    input: SearchCatalogDocumentsInput,
  ): Promise<SearchCatalogDocumentsOutput> {
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
  return {
    sourceKey: result.source.sourceKey,
    sourceName: result.source.displayName,
    documentPublicId: result.document.publicId,
    title: result.document.title,
    url: result.document.canonicalUrl,
    language: result.document.language,
    ...(result.section.heading === undefined ? {} : { heading: result.section.heading }),
    ...(result.section.headingPath === undefined
      ? {}
      : { headingPath: result.section.headingPath }),
    ...(result.section.anchor === undefined ? {} : { anchor: result.section.anchor }),
    snippet: result.snippet,
    score: result.score,
  };
}
