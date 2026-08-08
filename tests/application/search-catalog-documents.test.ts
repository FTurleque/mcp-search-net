import { describe, expect, it } from 'vitest';

import { SearchCatalogDocuments } from '../../src/application/use-cases/search-catalog-documents.js';
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

describe('SearchCatalogDocuments', () => {
  it('returns a stable serializable response and forwards filters to the repository', async () => {
    const repository = new SearchOnlyCatalogRepository([catalogSearchResult]);
    const useCase = new SearchCatalogDocuments(repository);

    const response = await useCase.execute({
      query: '  stream  ',
      sourceKey: 'nodejs-docs',
      language: 'en-US',
      limit: 3,
    });

    expect(repository.lastQuery).toEqual({
      query: 'stream',
      sourceKey: 'nodejs-docs',
      language: 'en-US',
      limit: 3,
    });
    expect(response).toEqual({
      schemaVersion: '1.0',
      query: 'stream',
      resultCount: 1,
      results: [
        {
          sourceKey: 'nodejs-docs',
          sourceName: 'Node.js Documentation',
          documentPublicId: 'nodejs-fs',
          sectionId: 1000,
          title: 'File system',
          url: 'https://nodejs.org/api/fs.html',
          language: 'en-US',
          heading: 'fs.createReadStream',
          headingPath: 'File system > fs.createReadStream',
          anchor: 'fscreatereadstream',
          snippet: 'Creates a readable stream from a file path.',
          score: 3,
        },
      ],
    });
  });

  it('rejects empty queries before reaching the repository', async () => {
    const repository = new SearchOnlyCatalogRepository([]);
    const useCase = new SearchCatalogDocuments(repository);

    await expect(useCase.execute({ query: '   ' })).rejects.toThrow(
      'Catalog search query must not be empty',
    );
    expect(repository.lastQuery).toBeUndefined();
  });
});

const now = new Date(1_000);

const catalogSearchResult: CatalogDocumentSearchResult = {
  source: {
    id: 1,
    sourceKey: 'nodejs-docs',
    displayName: 'Node.js Documentation',
    baseUrl: 'https://nodejs.org/api/',
    sourceType: 'api',
    language: 'en-US',
    freshnessPolicy: 'weekly',
    syncStrategy: 'manual',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  document: {
    id: 10,
    publicId: 'nodejs-fs',
    sourceId: 1,
    canonicalUrl: 'https://nodejs.org/api/fs.html',
    stableKey: 'fs',
    title: 'File system',
    mimeType: 'text/html',
    language: 'en-US',
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
    heading: 'fs.createReadStream',
    headingPath: 'File system > fs.createReadStream',
    headingLevel: 2,
    anchor: 'fscreatereadstream',
    content: 'Creates a readable stream from a file path.',
    contentHash: 'section-hash',
    characterCount: 42,
    tokenCount: 8,
  },
  snippet: 'Creates a readable stream from a file path.',
  score: 3,
};
