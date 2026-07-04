import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date(1_000);
  }
}

describe('SqliteCatalogRepository FTS index', () => {
  let repository: SqliteCatalogRepository | undefined;
  let directory: string | undefined;

  afterEach(() => {
    repository?.close();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rebuilds the FTS index from current active document sections', async () => {
    directory = mkdtempSync(join(tmpdir(), 'mcp-search-catalog-fts-'));
    repository = new SqliteCatalogRepository(join(directory, 'catalog.db'), new FixedClock());

    const source = await repository.addSource({
      sourceKey: 'sample-docs',
      displayName: 'Sample Documentation',
      baseUrl: 'https://example.test/docs/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'weekly',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await repository.upsertDocument({
      publicId: 'sample-guide',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/docs/guide.html',
      stableKey: 'guide',
      title: 'Sample Guide',
      mimeType: 'text/html',
      language: 'en-US',
      status: 'ACTIVE',
    });
    const version = await repository.addDocumentVersion({
      documentId: document.id,
      contentHash: 'version-hash',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await repository.replaceDocumentSections(version.id, [
      {
        ordinal: 1,
        heading: 'Alpha Topic',
        headingPath: 'Sample Guide > Alpha Topic',
        headingLevel: 2,
        anchor: 'alpha-topic',
        content: 'Alpha beta gamma content for the catalog index.',
        contentHash: 'section-hash',
        characterCount: 47,
        tokenCount: 8,
      },
    ]);

    const rebuilt = await repository.rebuildSearchIndex();
    const results = await repository.searchDocuments({ query: 'alpha beta' });

    expect(rebuilt).toEqual({ indexedSections: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: { sourceKey: 'sample-docs' },
      document: { publicId: 'sample-guide' },
      section: { heading: 'Alpha Topic' },
    });
  });
});
