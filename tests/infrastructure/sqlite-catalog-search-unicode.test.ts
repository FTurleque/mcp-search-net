import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];
const clock = { now: () => new Date('2026-08-11T19:00:00.000Z') };

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogSearch Unicode snippets', () => {
  it('keeps normalized UTF-16 offsets aligned after non-BMP characters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-unicode-snippet-'));
    roots.push(root);
    const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), clock);
    catalogs.push(catalog);

    const source = await catalog.addSource({
      sourceKey: 'unicode-docs',
      displayName: 'Unicode Documentation',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await catalog.upsertDocument({
      publicId: 'unicode-offsets',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/unicode-offsets',
      stableKey: 'unicode-offsets',
      title: 'Unicode offsets',
      mimeType: 'text/markdown',
      language: 'en',
      status: 'ACTIVE',
    });
    const version = await catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'unicode-offsets-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/markdown',
      metadataJson: '{}',
    });
    const content = `${'😀'.repeat(220)} needle appears near the end of this section.`;
    await catalog.replaceDocumentSections(version.id, [
      {
        ordinal: 0,
        heading: 'Unicode regression',
        content,
        contentHash: 'unicode-offset-section',
        characterCount: Array.from(content).length,
      },
    ]);

    const results = await catalog.searchDocuments({ query: 'needle', limit: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]?.snippet).toContain('needle');
    expect(results[0]?.snippet.startsWith('…')).toBe(true);
  });
});
