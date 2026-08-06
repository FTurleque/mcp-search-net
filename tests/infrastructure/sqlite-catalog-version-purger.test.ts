/* eslint-disable @typescript-eslint/no-deprecated -- low-level SQLite compatibility tests intentionally exercise legacy mutation paths */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { SqliteCatalogVersionPurger } from '../../src/infrastructure/catalog/sqlite-catalog-version-purger.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];
const purgers: SqliteCatalogVersionPurger[] = [];

afterEach(() => {
  purgers.splice(0).forEach((purger) => purger.close());
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogVersionPurger', () => {
  it('deletes old non-current versions beyond the retained history', async () => {
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

    await addVersionWithSection(fixture.catalog, document.id, 'hash-v1', 'section-v1');
    const [purgeableSectionId] = readNumberColumn(
      fixture.path,
      "SELECT id FROM document_sections WHERE content_hash = 'section-v1'",
    );
    expect(purgeableSectionId).toBeDefined();
    fixture.setNow(2_000);
    await addVersionWithSection(fixture.catalog, document.id, 'hash-v2', 'section-v2');
    fixture.setNow(3_000);
    const currentVersion = await addVersionWithSection(
      fixture.catalog,
      document.id,
      'hash-v3',
      'section-v3',
    );

    const purger = new SqliteCatalogVersionPurger(fixture.path, fixture.clock);
    purgers.push(purger);
    insertSectionIntoSearchIndex(fixture.path, purgeableSectionId!);
    expect(
      readNumberColumn(fixture.path, 'SELECT rowid FROM document_section_fts ORDER BY rowid'),
    ).toContain(purgeableSectionId);

    await expect(
      purger.purgeOldDocumentVersions({ keepPreviousVersions: 1, dryRun: true }),
    ).resolves.toEqual({
      dryRun: true,
      keptPreviousVersions: 1,
      scannedDocuments: 1,
      candidateVersions: 1,
      candidateSections: 1,
      purgedVersions: 0,
      purgedSections: 0,
    });
    expect(
      readColumn(fixture.path, 'SELECT content_hash FROM document_versions ORDER BY id'),
    ).toEqual(['hash-v1', 'hash-v2', 'hash-v3']);

    await expect(
      purger.purgeOldDocumentVersions({ keepPreviousVersions: 1, dryRun: false }),
    ).resolves.toEqual({
      dryRun: false,
      keptPreviousVersions: 1,
      scannedDocuments: 1,
      candidateVersions: 1,
      candidateSections: 1,
      purgedVersions: 1,
      purgedSections: 1,
    });

    expect(
      readColumn(fixture.path, 'SELECT content_hash FROM document_versions ORDER BY id'),
    ).toEqual(['hash-v2', 'hash-v3']);
    expect(
      readColumn(fixture.path, 'SELECT content_hash FROM document_sections ORDER BY id'),
    ).toEqual(['section-v2', 'section-v3']);
    expect(
      readNumberColumn(fixture.path, 'SELECT rowid FROM document_section_fts ORDER BY rowid'),
    ).not.toContain(purgeableSectionId);
    await expect(fixture.catalog.getDocumentByPublicId('nodejs-fs')).resolves.toMatchObject({
      currentVersionId: currentVersion.id,
    });
    await expect(purger.rebuildSearchIndex()).resolves.toEqual({ indexedSections: 1 });
  });
});

function createCatalogRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-purge-'));
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

async function addVersionWithSection(
  catalog: SqliteCatalogRepository,
  documentId: number,
  versionHash: string,
  sectionHash: string,
) {
  const version = await catalog.addDocumentVersion({
    documentId,
    contentHash: versionHash,
    isCurrent: true,
    extractionMode: 'static',
    contentType: 'text/html',
    metadataJson: '{}',
  });
  await catalog.replaceDocumentSections(version.id, [
    {
      ordinal: 1,
      content: `Content for ${sectionHash}`,
      contentHash: sectionHash,
      characterCount: 22,
    },
  ]);
  return version;
}

function readColumn(path: string, sql: string): readonly string[] {
  const database = new Database(path, { readonly: true });
  try {
    return (database.prepare(sql).all() as { content_hash: string }[]).map(
      (row) => row.content_hash,
    );
  } finally {
    database.close();
  }
}

function readNumberColumn(path: string, sql: string): readonly number[] {
  const database = new Database(path, { readonly: true });
  try {
    return (database.prepare(sql).all() as { id?: number; rowid?: number }[]).map(
      (row) => row.id ?? row.rowid!,
    );
  } finally {
    database.close();
  }
}

function insertSectionIntoSearchIndex(path: string, sectionId: number): void {
  const database = new Database(path);
  try {
    database
      .prepare(
        `INSERT INTO document_section_fts(
          rowid, section_id, document_id, source_key, language,
          title, heading, heading_path, content
        )
        SELECT
          document_sections.id,
          document_sections.id,
          documents.id,
          catalog_sources.source_key,
          documents.language,
          documents.title,
          coalesce(document_sections.heading, ''),
          coalesce(document_sections.heading_path, ''),
          document_sections.content
        FROM document_sections
        INNER JOIN document_versions
          ON document_versions.id = document_sections.document_version_id
        INNER JOIN documents
          ON documents.id = document_versions.document_id
        INNER JOIN catalog_sources
          ON catalog_sources.id = documents.source_id
        WHERE document_sections.id = ?`,
      )
      .run(sectionId);
  } finally {
    database.close();
  }
}
