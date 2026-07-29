import { describe, expect, it } from 'vitest';

import { RerankedSearchCatalogDocuments } from '../../src/application/use-cases/reranked-search-catalog-documents.js';
import type {
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
} from '../../src/domain/models/catalog.js';

class SearchOnlyCatalogRepository {
  public lastQuery: CatalogDocumentSearchQuery | undefined;

  public constructor(private readonly results: readonly CatalogDocumentSearchResult[]) {}

  public async searchDocuments(
    query: CatalogDocumentSearchQuery,
  ): Promise<readonly CatalogDocumentSearchResult[]> {
    this.lastQuery = query;
    return this.results;
  }
}

describe('RerankedSearchCatalogDocuments', () => {
  it('expands FTS candidates and returns honestly named lexical reranking scores', async () => {
    const repository = new SearchOnlyCatalogRepository([catalogSearchResult]);
    const useCase = new RerankedSearchCatalogDocuments(repository);

    const response = await useCase.execute({ query: 'sqlite maintenance', limit: 1 });

    expect(repository.lastQuery).toEqual({ query: 'sqlite maintenance', limit: 4 });
    expect(response.strategy).toBe('fts5-hashed-lexical-rerank');
    expect(response.schemaVersion).toBe('2.0');
    expect(response.resultCount).toBe(1);
    expect(response.results[0]?.sourceKey).toBe('local-docs');
    expect(response.results[0]?.rerankScore).toBeGreaterThan(0);
    expect(response.results[0]?.combinedScore).toBeGreaterThan(0);
    expect(response.results[0]).not.toHaveProperty('semanticScore');
  });

  it('rejects empty queries before reaching the repository', async () => {
    const repository = new SearchOnlyCatalogRepository([]);
    const useCase = new RerankedSearchCatalogDocuments(repository);

    await expect(useCase.execute({ query: '   ' })).rejects.toThrow(
      'Reranked catalog search query must not be empty',
    );
    expect(repository.lastQuery).toBeUndefined();
  });
});

const now = new Date(1_000);

const catalogSearchResult: CatalogDocumentSearchResult = {
  source: {
    id: 1,
    sourceKey: 'local-docs',
    displayName: 'Local docs',
    baseUrl: 'https://local.example/docs',
    sourceType: 'documentation',
    language: 'fr',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  document: {
    id: 10,
    publicId: 'catalog-maintenance',
    sourceId: 1,
    canonicalUrl: 'https://local.example/docs/catalog-maintenance',
    stableKey: 'catalog-maintenance',
    title: 'Catalog maintenance',
    mimeType: 'text/markdown',
    language: 'fr',
    status: 'ACTIVE',
    currentVersionId: 100,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  },
  section: {
    id: 1000,
    documentVersionId: 100,
    ordinal: 1,
    heading: 'SQLite maintenance',
    headingPath: 'Catalog > SQLite maintenance',
    headingLevel: 2,
    anchor: 'sqlite-maintenance',
    content: 'Maintenance and optimization of the SQLite catalog.',
    contentHash: 'section-hash',
    characterCount: 52,
    tokenCount: 8,
  },
  snippet: 'Maintenance and optimization of the SQLite catalog.',
  score: 3,
};
