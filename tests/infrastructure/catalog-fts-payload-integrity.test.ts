import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/domain/errors/domain-errors.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T18:00:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog FTS payload integrity', () => {
  it('fails closed on stale indexed content and rebuilds from authoritative sections', async () => {
    const path = await createHealthyCatalog();
    corruptIndexedContent(path);
    const openVerifiedCatalog = (): void => {
      new SqliteCatalogRepository(path, clock, { verifyIntegrityOnOpen: true }).close();
    };

    expect(openVerifiedCatalog).toThrow(ConfigurationError);

    const recovery = new SqliteCatalogRepository(path, clock);
    try {
      await expect(recovery.verifyIntegrity()).resolves.toMatchObject({
        issues: [expect.objectContaining({ code: 'FTS_ENTRY_CONTENT_MISMATCH' })],
      });
      await expect(recovery.searchDocuments({ query: 'obsolete' })).resolves.toHaveLength(1);

      await expect(recovery.rebuildSearchIndex()).resolves.toMatchObject({ indexedSections: 1 });
      await expect(recovery.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
      await expect(recovery.searchDocuments({ query: 'obsolete' })).resolves.toEqual([]);
      await expect(recovery.searchDocuments({ query: 'authoritative' })).resolves.toHaveLength(1);
    } finally {
      recovery.close();
    }

    expect(openVerifiedCatalog).not.toThrow();
  });
});

async function createHealthyCatalog(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-fts-payload-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const repository = new SqliteCatalogRepository(path, clock);
  const source = await repository.addSource({
    sourceKey: 'docs',
    displayName: 'Documentation',
    baseUrl: 'https://docs.example/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  await repository.commitDocumentRevision({
    document: {
      publicId: 'guide',
      sourceId: source.id,
      canonicalUrl: 'https://docs.example/guide',
      stableKey: 'guide',
      title: 'Guide',
      mimeType: 'text/plain',
      language: 'en',
      status: 'ACTIVE',
    },
    version: {
      contentHash: 'version-hash',
      extractionMode: 'static',
      contentType: 'text/plain',
      metadataJson: '{}',
    },
    sections: [
      {
        ordinal: 0,
        heading: 'Guide',
        content: 'authoritative searchable guide content',
        contentHash: 'section-hash',
        characterCount: 38,
        tokenCount: 4,
      },
    ],
  });
  repository.close();
  return path;
}

function corruptIndexedContent(path: string): void {
  const database = new Database(path);
  try {
    database.prepare("UPDATE document_section_fts SET content = 'obsolete indexed payload'").run();
  } finally {
    database.close();
  }
}
