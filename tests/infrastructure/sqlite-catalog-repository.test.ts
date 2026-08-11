/* eslint-disable @typescript-eslint/no-deprecated -- low-level SQLite compatibility tests intentionally exercise legacy mutation paths */
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

const EXPECTED_CATALOG_TABLES = [
  'catalog_schema_migrations',
  'catalog_sources',
  'document_aliases',
  'document_section_fts',
  'document_section_fts_config',
  'document_section_fts_data',
  'document_section_fts_docsize',
  'document_section_fts_idx',
  'document_sections',
  'document_versions',
  'documents',
  'staleness_events',
  'sync_runs',
];

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
    const tables = readTables(database);
    const migrations = database
      .prepare('SELECT version, checksum FROM catalog_schema_migrations ORDER BY version')
      .all() as { version: number; checksum: string }[];
    database.close();

    expect(tables).toEqual(EXPECTED_CATALOG_TABLES);
    expect(migrations.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(migrations.every(({ checksum }) => /^[a-f0-9]{64}$/u.test(checksum))).toBe(true);
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
    expect(sections[0]).toMatchObject({
      heading: 'fs.readFile',
      documentVersionId: version.id,
    });
  });

  it('returns the current version with sync validators for an existing document', async () => {
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
    const oldVersion = await fixture.catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'hash-v1',
      etag: '"v1"',
      lastModified: 'Sun, 21 Jun 2026 00:00:00 GMT',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await fixture.catalog.replaceDocumentSections(oldVersion.id, [
      {
        ordinal: 0,
        content: 'Old synchronized content.',
        contentHash: 'old-section',
        characterCount: 25,
      },
    ]);
    const currentVersion = await fixture.catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'hash-v2',
      etag: '"v2"',
      lastModified: 'Tue, 02 Jul 2026 10:00:00 GMT',
      publishedAt: new Date(2_000),
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{"source":"sync"}',
    });
    await fixture.catalog.replaceDocumentSections(currentVersion.id, [
      {
        ordinal: 0,
        content: 'Current synchronized content.',
        contentHash: 'current-section',
        characterCount: 29,
      },
    ]);

    await expect(fixture.catalog.getCurrentDocumentVersion(document.id)).resolves.toMatchObject({
      id: currentVersion.id,
      documentId: document.id,
      contentHash: 'hash-v2',
      etag: '"v2"',
      lastModified: 'Tue, 02 Jul 2026 10:00:00 GMT',
      isCurrent: true,
    });
    await expect(
      fixture.catalog.getCurrentDocumentVersion(oldVersion.documentId + 999),
    ).resolves.toBeUndefined();
  });

  it('searches only enabled active documents on their current sections', async () => {
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
    const disabledSource = await fixture.catalog.addSource({
      sourceKey: 'disabled-docs',
      displayName: 'Disabled Documentation',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: false,
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
    const firstVersion = await fixture.catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'nodejs-fs-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await fixture.catalog.replaceDocumentSections(firstVersion.id, [
      {
        ordinal: 1,
        heading: 'Old stream section',
        content: 'This stream section belongs to a previous version.',
        contentHash: 'nodejs-fs-v1-section',
        characterCount: 51,
      },
    ]);

    const currentVersion = await fixture.catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'nodejs-fs-v2',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await fixture.catalog.replaceDocumentSections(currentVersion.id, [
      {
        ordinal: 1,
        heading: 'fs.createReadStream',
        headingPath: 'File system > fs.createReadStream',
        headingLevel: 2,
        anchor: 'fscreatereadstream',
        content: 'Creates a readable stream from a file path.',
        contentHash: 'nodejs-fs-v2-section',
        characterCount: 42,
      },
    ]);

    const staleDocument = await fixture.catalog.upsertDocument({
      publicId: 'nodejs-stale-stream',
      sourceId: source.id,
      canonicalUrl: 'https://nodejs.org/api/stale.html',
      stableKey: 'stale-stream',
      title: 'Stale stream',
      mimeType: 'text/html',
      language: 'en-US',
      status: 'STALE',
    });
    const staleVersion = await fixture.catalog.addDocumentVersion({
      documentId: staleDocument.id,
      contentHash: 'nodejs-stale-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await fixture.catalog.replaceDocumentSections(staleVersion.id, [
      {
        ordinal: 1,
        content: 'A stale stream result.',
        contentHash: 'nodejs-stale-section',
        characterCount: 22,
      },
    ]);

    const disabledDocument = await fixture.catalog.upsertDocument({
      publicId: 'disabled-stream',
      sourceId: disabledSource.id,
      canonicalUrl: 'https://example.test/stream.html',
      stableKey: 'stream',
      title: 'Disabled stream',
      mimeType: 'text/html',
      language: 'en-US',
      status: 'ACTIVE',
    });
    const disabledVersion = await fixture.catalog.addDocumentVersion({
      documentId: disabledDocument.id,
      contentHash: 'disabled-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await fixture.catalog.replaceDocumentSections(disabledVersion.id, [
      {
        ordinal: 1,
        content: 'Disabled stream result.',
        contentHash: 'disabled-section',
        characterCount: 23,
      },
    ]);

    const results = await fixture.catalog.searchDocuments({
      query: 'STREAM',
      sourceKey: 'nodejs-docs',
      language: 'en-US',
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      score: 3,
      source: { sourceKey: 'nodejs-docs' },
      document: { publicId: 'nodejs-fs' },
      section: {
        documentVersionId: currentVersion.id,
        heading: 'fs.createReadStream',
      },
    });
    expect(results[0]?.snippet).toContain('stream');
    await expect(fixture.catalog.searchDocuments({ query: '   ' })).resolves.toEqual([]);
    await expect(
      fixture.catalog.searchDocuments({ query: 'stream', language: 'fr-FR' }),
    ).resolves.toEqual([]);
  });

  it('centers a bounded multi-term snippet on the densest matching window', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource({
      sourceKey: 'snippet-docs',
      displayName: 'Snippet docs',
      baseUrl: 'https://example.test/docs/',
      sourceType: 'documentation',
      language: 'en-US',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    await fixture.catalog.commitDocumentRevision({
      document: {
        publicId: 'multi-term-snippet',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/docs/snippet',
        stableKey: 'snippet',
        title: 'Multi-term snippet',
        mimeType: 'text/markdown',
        language: 'en-US',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'multi-term-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          content: `IRRELEVANT_BEGIN alpha ${'filler '.repeat(35)}Focused alpha guidance places beta nearby.`,
          contentHash: 'multi-term-section',
          characterCount: 340,
          tokenCount: 42,
        },
      ],
    });

    const [result] = await fixture.catalog.searchDocuments({ query: 'alpha beta' });

    expect(result?.snippet).toContain('alpha guidance places beta');
    expect(result?.snippet).not.toContain('IRRELEVANT_BEGIN');
    expect(result?.snippet.length).toBeLessThanOrEqual(162);
  });

  it('keeps catalog tables out of cache.db and V1 cache tables out of catalog.db', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-separation-'));
    roots.push(root);
    const now = 0;
    const clock = { now: () => new Date(now) };
    const cachePath = join(root, '.data', 'cache.db');
    const catalogPath = join(root, '.data', 'catalog.db');
    const cache = new SqliteCacheRepository(cachePath, clock, 100, 1_000_000, 10_000);
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

  it('enforces source uniqueness and preserves repeated section occurrences', async () => {
    const fixture = createCatalogRepository();
    await expect(
      fixture.catalog.addSource({
        sourceKey: 'invalid-source',
        displayName: 'Invalid source',
        baseUrl: 'file:///tmp/docs',
        sourceType: 'documentation',
        language: 'en',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      }),
    ).rejects.toThrow('CATALOG_SOURCE_BASE_URL_INVALID');
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
          content: 'Repeated content.',
          contentHash: 'duplicate-section',
          characterCount: 17,
        },
        {
          ordinal: 2,
          content: 'Repeated content.',
          contentHash: 'duplicate-section',
          characterCount: 17,
        },
      ]),
    ).resolves.toHaveLength(2);

    const database = new Database(fixture.path, { readonly: true });
    const rows = database
      .prepare('SELECT ordinal, content_hash FROM document_sections ORDER BY ordinal')
      .all() as { ordinal: number; content_hash: string }[];
    expect(rows).toEqual([
      { ordinal: 1, content_hash: 'duplicate-section' },
      { ordinal: 2, content_hash: 'duplicate-section' },
    ]);
    database.close();
  });

  it('persists the RUNNING to terminal sync lifecycle and rejects invalid transitions', async () => {
    const fixture = createCatalogRepository();
    const running = await fixture.catalog.startCatalogSyncRun({ startedAt: new Date(1_000) });

    expect(running).toMatchObject({
      runKind: 'EXECUTION',
      status: 'RUNNING',
      startedAt: new Date(1_000),
      documentsChecked: 0,
      documentsFailed: 0,
    });
    expect(running.completedAt).toBeUndefined();

    const completed = await fixture.catalog.completeCatalogSyncRun(running.id, {
      completedAt: new Date(2_000),
      status: 'PARTIAL',
      documentsChecked: 2,
      documentsAdded: 1,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 1,
      errorSummary: '1 document(s) failed',
    });
    expect(completed).toMatchObject({
      id: running.id,
      runKind: 'EXECUTION',
      startedAt: new Date(1_000),
      completedAt: new Date(2_000),
      status: 'PARTIAL',
      documentsChecked: 2,
      documentsAdded: 1,
      documentsFailed: 1,
    });

    await expect(
      fixture.catalog.completeCatalogSyncRun(running.id, {
        completedAt: new Date(3_000),
        status: 'SUCCESS',
        documentsChecked: 2,
        documentsAdded: 1,
        documentsUpdated: 0,
        documentsUnchanged: 1,
        documentsFailed: 0,
      }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_ALREADY_COMPLETED');

    const second = await fixture.catalog.startCatalogSyncRun({ startedAt: new Date(5_000) });
    await expect(
      fixture.catalog.completeCatalogSyncRun(second.id, {
        completedAt: new Date(4_000),
        status: 'FAILED',
        documentsChecked: 0,
        documentsAdded: 0,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
      }),
    ).rejects.toThrow('CATALOG_SYNC_RUN_COMPLETION_PRECEDES_START');
  });

  it('touches observations without version, section or FTS churn and upserts tracking atomically', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource({
      sourceKey: 'touch-docs',
      displayName: 'Touch docs',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const revision = await fixture.catalog.commitDocumentRevision({
      document: {
        publicId: 'touch-guide',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/guide',
        stableKey: 'guide',
        title: 'Touch guide',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'touch-hash-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          heading: 'Guide',
          content: 'Stable searchable observation content.',
          contentHash: 'touch-section-v1',
          characterCount: 38,
        },
      ],
    });
    const run = await fixture.catalog.startCatalogSyncRun({ startedAt: new Date(2_000) });
    const before = readObservationSnapshot(fixture.path);

    fixture.setNow(3_000);
    const touched = await fixture.catalog.touchDocumentObservation(revision.document.id, {
      syncRunId: run.id,
      aliases: [{ url: 'https://example.test/old-guide', aliasType: 'REDIRECT' }],
      events: [
        {
          eventType: 'PERMANENT_REDIRECT',
          detailsJson: '{"status":301}',
        },
      ],
    });

    expect(touched.lastSeenAt).toEqual(new Date(3_000));
    expect(touched.updatedAt).toEqual(revision.document.updatedAt);
    expect(readObservationSnapshot(fixture.path)).toEqual({
      ...before,
      lastSeenAt: 3_000,
    });

    fixture.setNow(4_000);
    await fixture.catalog.touchDocumentObservation(revision.document.id, {
      syncRunId: run.id,
      aliases: [{ url: 'https://example.test/old-guide', aliasType: 'OLD_URL' }],
    });
    const database = new Database(fixture.path, { readonly: true });
    expect(
      database
        .prepare(
          'SELECT url, alias_type, first_seen_at, last_seen_at FROM document_aliases WHERE document_id = ?',
        )
        .all(revision.document.id),
    ).toEqual([
      {
        url: 'https://example.test/old-guide',
        alias_type: 'OLD_URL',
        first_seen_at: 3_000,
        last_seen_at: 4_000,
      },
    ]);
    expect(
      database.prepare('SELECT sync_run_id, event_type, details_json FROM staleness_events').all(),
    ).toEqual([
      {
        sync_run_id: run.id,
        event_type: 'PERMANENT_REDIRECT',
        details_json: '{"status":301}',
      },
    ]);
    database.close();

    fixture.setNow(5_000);
    await expect(
      fixture.catalog.touchDocumentObservation(revision.document.id, {
        syncRunId: 999_999,
        events: [{ eventType: 'SOURCE_UNAVAILABLE', detailsJson: '{}' }],
      }),
    ).rejects.toThrow(/FOREIGN KEY/u);
    await expect(fixture.catalog.getDocumentById(revision.document.id)).resolves.toMatchObject({
      lastSeenAt: new Date(4_000),
    });
  });

  it('keeps a 304 redirect metadata transition atomic and the searchable index consistent', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource({
      sourceKey: 'redirect-docs',
      displayName: 'Redirect docs',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const revision = await fixture.catalog.commitDocumentRevision({
      document: {
        publicId: 'redirect-guide',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/old-guide',
        stableKey: 'guide',
        title: 'Redirect guide',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'redirect-hash-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          heading: 'Guide',
          content: 'Stable redirect content.',
          contentHash: 'redirect-section-v1',
          characterCount: 24,
        },
      ],
    });
    const run = await fixture.catalog.startCatalogSyncRun({ startedAt: new Date(2_000) });

    fixture.setNow(3_000);
    const redirected = await fixture.catalog.upsertDocument(
      {
        publicId: revision.document.publicId,
        sourceId: source.id,
        canonicalUrl: 'https://example.test/new-guide',
        stableKey: revision.document.stableKey,
        title: revision.document.title,
        mimeType: revision.document.mimeType,
        language: revision.document.language,
        status: 'REDIRECTED',
      },
      {
        syncRunId: run.id,
        aliases: [{ url: revision.document.canonicalUrl, aliasType: 'REDIRECT' }],
        events: [{ eventType: 'PERMANENT_REDIRECT', detailsJson: '{"status":301}' }],
      },
    );

    expect(redirected).toMatchObject({
      id: revision.document.id,
      stableKey: revision.document.stableKey,
      canonicalUrl: 'https://example.test/new-guide',
      status: 'REDIRECTED',
      currentVersionId: revision.version.id,
    });
    const database = new Database(fixture.path, { readonly: true });
    expect(database.prepare('SELECT id FROM document_versions').all()).toEqual([
      { id: revision.version.id },
    ]);
    expect(database.prepare('SELECT id FROM document_sections').all()).toEqual([
      { id: revision.sections[0]?.id },
    ]);
    expect(database.prepare('SELECT rowid FROM document_section_fts').all()).toEqual([]);
    database.close();
    await expect(fixture.catalog.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
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

function readObservationSnapshot(path: string) {
  const database = new Database(path, { readonly: true });
  try {
    const document = database
      .prepare(
        'SELECT current_version_id, last_seen_at, updated_at FROM documents WHERE public_id = ?',
      )
      .get('touch-guide') as {
      current_version_id: number;
      last_seen_at: number;
      updated_at: number;
    };
    const versionIds = database.prepare('SELECT id FROM document_versions ORDER BY id').all() as {
      id: number;
    }[];
    const sectionIds = database.prepare('SELECT id FROM document_sections ORDER BY id').all() as {
      id: number;
    }[];
    const ftsRowIds = database
      .prepare('SELECT rowid FROM document_section_fts ORDER BY rowid')
      .all() as { rowid: number }[];
    return {
      currentVersionId: document.current_version_id,
      lastSeenAt: document.last_seen_at,
      updatedAt: document.updated_at,
      versionIds: versionIds.map(({ id }) => id),
      sectionIds: sectionIds.map(({ id }) => id),
      ftsRowIds: ftsRowIds.map(({ rowid }) => rowid),
    };
  } finally {
    database.close();
  }
}
