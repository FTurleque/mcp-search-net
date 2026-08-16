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
    const row = database
      .prepare<[], { readonly section_id: number; readonly document_id: number }>(
        `
        SELECT document_sections.id AS section_id, documents.id AS document_id
        FROM document_sections
        INNER JOIN document_versions
          ON document_versions.id = document_sections.document_version_id
        INNER JOIN documents ON documents.id = document_versions.document_id
        WHERE documents.public_id = 'guide'
        LIMIT 1
      `,
      )
      .get();
    if (row === undefined) throw new Error('TEST_SECTION_NOT_FOUND');

    database.prepare<[number]>('DELETE FROM document_section_fts WHERE rowid = ?').run(row.section_id);
    database
      .prepare<[number, number, number, string, string, string, string, string, string]>(
        `
        INSERT INTO document_section_fts(
          rowid, section_id, document_id, source_key, language,
          title, heading, heading_path, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        row.section_id,
        row.section_id,
        row.document_id,
        'docs',
        'en',
        'Guide',
        'Guide',
        '',
        'obsolete indexed payload',
      );
  } finally {
    database.close();
  }
}
