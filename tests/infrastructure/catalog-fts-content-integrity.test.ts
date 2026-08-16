import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/domain/errors/domain-errors.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T20:00:00.000Z') };
const startupOptions = { verifyIntegrityOnOpen: true } as const;

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog FTS logical integrity', () => {
  it('detects stale content with the same rowid, fails closed, and recovers after rebuild', async () => {
    const path = await healthyCatalog();
    sabotageFts(path, "content = 'obsolete phantom phrase'");

    const diagnosticRepository = new SqliteCatalogRepository(path, clock);
    try {
      const report = await diagnosticRepository.verifyIntegrity();
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: 'FTS_ENTRY_CONTENT_MISMATCH',
          sourceKey: 'docs',
          documentPublicId: 'guide',
        }),
      );
      expect(report.counts.currentSections).toBe(1);
      expect(report.counts.indexedSections).toBe(1);

      const falsePositive = await diagnosticRepository.searchDocuments({
        query: 'obsolete phantom phrase',
      });
      expect(falsePositive).toHaveLength(1);
    } finally {
      diagnosticRepository.close();
    }

    expect(() => new SqliteCatalogRepository(path, clock, startupOptions)).toThrow(
      ConfigurationError,
    );

    const recoveryRepository = new SqliteCatalogRepository(path, clock);
    try {
      await expect(recoveryRepository.rebuildSearchIndex()).resolves.toEqual({
        indexedSections: 1,
      });
      await expect(recoveryRepository.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
      await expect(
        recoveryRepository.searchDocuments({ query: 'authoritative searchable phrase' }),
      ).resolves.toHaveLength(1);
      await expect(
        recoveryRepository.searchDocuments({ query: 'obsolete phantom phrase' }),
      ).resolves.toHaveLength(0);
    } finally {
      recoveryRepository.close();
    }

    expect(() => new SqliteCatalogRepository(path, clock, startupOptions).close()).not.toThrow();
  });

  it('detects indexed metadata divergence without changing the FTS rowid', async () => {
    const path = await healthyCatalog();
    sabotageFts(path, "title = 'Obsolete metadata title'");

    const repository = new SqliteCatalogRepository(path, clock);
    try {
      const report = await repository.verifyIntegrity();
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: 'FTS_ENTRY_CONTENT_MISMATCH',
          sourceKey: 'docs',
          documentPublicId: 'guide',
        }),
      );
      expect(
        report.issues.filter((issue) => issue.code === 'FTS_ENTRY_CONTENT_MISMATCH'),
      ).toHaveLength(1);
    } finally {
      repository.close();
    }
  });
});

async function healthyCatalog(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'catalog-fts-logical-integrity-'));
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
  const content = 'authoritative searchable phrase';
  await repository.commitDocumentRevision({
    document: {
      publicId: 'guide',
      sourceId: source.id,
      canonicalUrl: 'https://docs.example/guide',
      stableKey: 'guide',
      title: 'Authoritative guide',
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
        heading: 'Authoritative heading',
        headingPath: 'Guide > Authoritative heading',
        content,
        contentHash: 'section-hash',
        characterCount: Array.from(content).length,
        tokenCount: 3,
      },
    ],
  });
  repository.close();
  return path;
}

function sabotageFts(path: string, assignment: string): void {
  const database = new Database(path);
  try {
    const row = database
      .prepare<[], { readonly rowid: number }>('SELECT rowid FROM document_section_fts LIMIT 1')
      .get();
    if (row === undefined) throw new Error('Expected populated FTS fixture');
    database.exec(`UPDATE document_section_fts SET ${assignment} WHERE rowid = ${row.rowid}`);
    const preserved = database
      .prepare<
        [number],
        { readonly rowid: number }
      >('SELECT rowid FROM document_section_fts WHERE rowid = ?')
      .get(row.rowid);
    expect(preserved?.rowid).toBe(row.rowid);
  } finally {
    database.close();
  }
}
