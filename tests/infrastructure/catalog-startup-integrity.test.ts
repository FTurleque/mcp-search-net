import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/domain/errors/domain-errors.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-11T00:00:00.000Z') };
const startupOptions = { verifyIntegrityOnOpen: true } as const;

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog startup integrity gate', () => {
  it('accepts an empty healthy catalog', () => {
    const path = catalogPath('empty');
    const repository = new SqliteCatalogRepository(path, clock, startupOptions);
    repository.close();
    expect(() => new SqliteCatalogRepository(path, clock, startupOptions).close()).not.toThrow();
  });

  it('fails closed for a structurally corrupt SQLite file', () => {
    const path = catalogPath('corrupt');
    writeFileSync(path, 'not-a-sqlite-database');
    expect(() => new SqliteCatalogRepository(path, clock, startupOptions)).toThrow(
      ConfigurationError,
    );
  });

  it('fails closed for a foreign-key violation', () => {
    const path = catalogPath('foreign-key');
    new SqliteCatalogRepository(path, clock, startupOptions).close();
    const database = new Database(path);
    database.pragma('foreign_keys = OFF');
    database.exec(`
      INSERT INTO documents(
        public_id, source_id, canonical_url, stable_key, title, mime_type,
        language, status, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES ('orphan', 999, 'https://example.test/orphan', 'orphan', 'Orphan',
        'text/plain', 'en', 'ACTIVE', 1, 1, 1, 1);
    `);
    database.close();
    expect(() => new SqliteCatalogRepository(path, clock, startupOptions)).toThrow(
      ConfigurationError,
    );
  });

  it.each([
    [
      'an incoherent current pointer',
      'UPDATE document_versions SET is_current = 0 WHERE is_current = 1',
    ],
    ['a missing current FTS row', 'DELETE FROM document_section_fts'],
    [
      'a current version without sections',
      'DELETE FROM document_sections WHERE document_version_id IN (SELECT id FROM document_versions WHERE is_current = 1)',
    ],
  ])('fails closed for %s', async (_label, sabotage) => {
    const path = await healthyCatalog();
    const database = new Database(path);
    database.exec(sabotage);
    database.close();

    expect(() => new SqliteCatalogRepository(path, clock, startupOptions)).toThrow(
      ConfigurationError,
    );
  });

  it('keeps the administrative recovery path available for a rebuildable index mismatch', async () => {
    const path = await healthyCatalog();
    const database = new Database(path);
    database.exec('DELETE FROM document_section_fts');
    database.close();

    expect(() => new SqliteCatalogRepository(path, clock, startupOptions)).toThrow(
      ConfigurationError,
    );

    const recoveryRepository = new SqliteCatalogRepository(path, clock);
    try {
      await expect(recoveryRepository.rebuildSearchIndex()).resolves.toMatchObject({
        indexedSections: 1,
      });
      await expect(recoveryRepository.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
    } finally {
      recoveryRepository.close();
    }

    expect(() => new SqliteCatalogRepository(path, clock, startupOptions).close()).not.toThrow();
  });

  it('accepts a populated healthy catalog after reopen', async () => {
    const path = await healthyCatalog();
    const repository = new SqliteCatalogRepository(path, clock, startupOptions);
    await expect(repository.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
    repository.close();
  });
});

function catalogPath(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `catalog-startup-${label}-`));
  roots.push(root);
  return join(root, 'catalog.db');
}

async function healthyCatalog(): Promise<string> {
  const path = catalogPath('healthy');
  const repository = new SqliteCatalogRepository(path, clock);
  const source = await repository.addSource({
    sourceKey: 'healthy',
    displayName: 'Healthy',
    baseUrl: 'https://example.test/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  await repository.commitDocumentRevision({
    document: {
      publicId: 'healthy-guide',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/guide',
      stableKey: 'guide',
      title: 'Healthy guide',
      mimeType: 'text/plain',
      language: 'en',
      status: 'ACTIVE',
    },
    version: {
      contentHash: 'healthy-version',
      extractionMode: 'static',
      contentType: 'text/plain',
      metadataJson: '{}',
    },
    sections: [
      {
        ordinal: 0,
        heading: 'Healthy',
        content: 'healthy searchable content',
        contentHash: 'healthy-section',
        characterCount: 26,
        tokenCount: 3,
      },
    ],
  });
  repository.close();
  return path;
}
