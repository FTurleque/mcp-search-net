import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];
const caches: SqliteCacheRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  caches.splice(0).forEach((cache) => cache.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogRepository', () => {
  it('applies catalog migrations once and keeps their order', () => {
    const fixture = createCatalogRepository();
    fixture.catalog.close();
    catalogs.splice(catalogs.indexOf(fixture.catalog), 1);

    const secondRepository = new SqliteCatalogRepository(fixture.path, fixture.clock);
    catalogs.push(secondRepository);

    const database = new Database(fixture.path, { readonly: true });
    expect(readTables(database)).toEqual([
      'catalog_schema_migrations',
      'catalog_sources',
      'document_aliases',
      'document_sections',
      'document_versions',
      'documents',
      'staleness_events',
      'sync_runs',
    ]);
    const versions = database
      .prepare('SELECT version FROM catalog_schema_migrations ORDER BY version')
      .all() as { version: number }[];
    expect(versions.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5]);
    database.close();
  });

  it('stores sources, documents, versions and sections', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource({
      sourceKey: 'nodejs-docs',
      displayName: 'Node.js Documentation',
      baseUrl: 'https://nodejs.org/api/',
      sourceType: 'api',
      language: 'en-US',
      freshnessPolicy: 'weekly',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await fixture.catalog.upsertDocument({
      publicId: 'nodejs-fs',
      sourceId: source.id,
      canonicalUrl: 'https://nodejs.org/api/fs.html',
      stableKey: 'fs',
      title: 'File system',
      mimeType: 'text/html',
      language: 'en-US',
      status: 'ACTIVE',
    });
    const version = await fixture.catalog.addDocumentVersion({
      documentId: document.id,
      versionLabel: '24.17.0',
      contentHash: 'hash-v1',
      etag: '"v1"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      publishedAt: new Date(1_000),
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    const sections = await fixture.catalog.replaceDocumentSections(version.id, [
      {
        ordinal: 1,
        heading: 'fs.readFile',
        headingPath: 'File system > fs.readFile',
        headingLevel: 2,
        anchor: 'fsreadfile',
        content: 'Reads the entire contents of a file.',
        contentHash: 'section-hash-1',
        characterCount: 36,
        tokenCount: 8,
      },
    ]);

    await expect(fixture.catalog.getSourceByKey('nodejs-docs')).resolves.toMatchObject({
      id: source.id,
      enabled: true,
    });
    await expect(fixture.catalog.getDocumentByPublicId('nodejs-fs')).resolves.toMatchObject({
      id: document.id,
      currentVersionId: version.id,
      status: 'ACTIVE',
    });
    await expect(fixture.catalog.listSources()).resolves.toHaveLength(1);
    await expect(fixture.catalog.listDocuments()).resolves.toHaveLength(1);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ heading: 'fs.readFile', documentVersionId: version.id });
  });

  it('keeps catalog tables out of cache.db and V1 cache tables out of catalog.db', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-separation-'));
    roots.push(root);
    const now = 0;
    const clock = { now: () => new Date(now) };
    const cachePath = join(root, '.data', 'cache.db');
    const catalogPath = join(root, '.data', 'catalog.db');
    const cache = new SqliteCacheRepository(cachePath, clock, 100, 10_000);
    const catalog = new SqliteCatalogRepository(catalogPath, clock);
    caches.push(cache);
    catalogs.push(catalog);

    const cacheDatabase = new Database(cachePath, { readonly: true });
    const catalogDatabase = new Database(catalogPath, { readonly: true });
    expect(readTables(cacheDatabase)).toEqual([
      'content_cache',
      'schema_migrations',
      'search_cache',
    ]);
    expect(readTables(catalogDatabase)).not.toContain('search_cache');
    expect(readTables(catalogDatabase)).not.toContain('content_cache');
    expect(readTables(cacheDatabase)).not.toContain('catalog_sources');
    expect(readTables(cacheDatabase)).not.toContain('documents');
    cacheDatabase.close();
    catalogDatabase.close();
  });

  it('enforces source uniqueness and rolls back failed section replacement', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource({
      sourceKey: 'typescript-docs',
      displayName: 'TypeScript Documentation',
      baseUrl: 'https://www.typescriptlang.org/docs/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'monthly',
      syncStrategy: 'manual',
      enabled: true,
    });
    await expect(
      fixture.catalog.addSource({
        sourceKey: 'typescript-docs',
        displayName: 'Duplicate',
        baseUrl: 'https://www.typescriptlang.org/docs/',
        sourceType: 'documentation',
        language: 'en-US',
        freshnessPolicy: 'monthly',
        syncStrategy: 'manual',
        enabled: true,
      }),
    ).rejects.toThrow();

    const document = await fixture.catalog.upsertDocument({
      publicId: 'ts-handbook',
      sourceId: source.id,
      canonicalUrl: 'https://www.typescriptlang.org/docs/handbook/intro.html',
      stableKey: 'handbook-intro',
      title: 'Handbook intro',
      mimeType: 'text/html',
      language: 'en-US',
      status: 'ACTIVE',
    });
    const version = await fixture.catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'ts-hash-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await fixture.catalog.replaceDocumentSections(version.id, [
      {
        ordinal: 1,
        content: 'Existing section.',
        contentHash: 'existing-section',
        characterCount: 17,
      },
    ]);

    await expect(
      fixture.catalog.replaceDocumentSections(version.id, [
        {
          ordinal: 1,
          content: 'Duplicate content A.',
          contentHash: 'duplicate-section',
          characterCount: 20,
        },
        {
          ordinal: 2,
          content: 'Duplicate content B.',
          contentHash: 'duplicate-section',
          characterCount: 20,
        },
      ]),
    ).rejects.toThrow();

    const database = new Database(fixture.path, { readonly: true });
    const rows = database
      .prepare('SELECT ordinal, content_hash FROM document_sections ORDER BY ordinal')
      .all() as { ordinal: number; content_hash: string }[];
    expect(rows).toEqual([{ ordinal: 1, content_hash: 'existing-section' }]);
    database.close();
  });
});

function createCatalogRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  let now = 1_000;
  const clock = { now: () => new Date(now) };
  const catalog = new SqliteCatalogRepository(path, clock);
  catalogs.push(catalog);
  return {
    catalog,
    clock,
    path,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function readTables(database: Database.Database): readonly string[] {
  return (
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => name);
}
