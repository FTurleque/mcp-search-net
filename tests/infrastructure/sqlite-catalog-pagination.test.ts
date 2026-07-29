import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_CATALOG_PAGE_SIZE } from '../../src/application/ports/catalog-repository.js';
import type { DocumentStatus } from '../../src/domain/models/catalog.js';
import {
  createDocumentEntriesPageSql,
  SELECT_CATALOG_SOURCE_BY_ID_SQL,
  SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL,
  SELECT_DOCUMENT_BY_ID_SQL,
} from '../../src/infrastructure/catalog/catalog-sql.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogRepository scalable pages', () => {
  it('uses targeted lookups, SQL filters and stable id pagination', async () => {
    const fixture = createCatalogRepository();
    const firstSource = await addSource(fixture.catalog, 'first-source');
    const secondSource = await addSource(fixture.catalog, 'second-source');

    for (let index = 0; index < 6; index += 1) {
      await addDocument(fixture.catalog, {
        sourceId: index < 4 ? firstSource.id : secondSource.id,
        sourceKey: index < 4 ? firstSource.sourceKey : secondSource.sourceKey,
        index,
        language: index % 2 === 0 ? 'en' : 'fr',
        status: index === 5 ? 'STALE' : 'ACTIVE',
      });
    }

    const completePage = await fixture.catalog.listDocumentsPage({ offset: 0, limit: 10 });
    const expectedIds = completePage.items.map(({ document }) => document.id);
    const firstPage = await fixture.catalog.listDocumentsPage({ offset: 0, limit: 2 });
    const secondPage = await fixture.catalog.listDocumentsPage({ offset: 2, limit: 2 });
    expect(firstPage).toMatchObject({ offset: 0, limit: 2, total: 6 });
    expect(firstPage.items.map(({ document }) => document.id)).toEqual(expectedIds.slice(0, 2));
    expect(secondPage.items.map(({ document }) => document.id)).toEqual(expectedIds.slice(2, 4));

    await addDocument(fixture.catalog, {
      sourceId: firstSource.id,
      sourceKey: firstSource.sourceKey,
      index: 6,
      language: 'fr',
      status: 'ACTIVE',
    });
    const stableSecondPage = await fixture.catalog.listDocumentsPage({ offset: 2, limit: 2 });
    expect(stableSecondPage.total).toBe(7);
    expect(stableSecondPage.items.map(({ document }) => document.id)).toEqual(
      expectedIds.slice(2, 4),
    );

    const filtered = await fixture.catalog.listDocumentsPage({
      offset: 0,
      limit: 10,
      sourceKey: firstSource.sourceKey,
      language: 'fr',
      status: 'ACTIVE',
    });
    expect(filtered.total).toBe(3);
    expect(
      filtered.items.every(
        ({ source, document }) =>
          source.id === firstSource.id &&
          document.language === 'fr' &&
          document.status === 'ACTIVE',
      ),
    ).toBe(true);

    const document = firstPage.items[0]?.document;
    expect(document).toBeDefined();
    await expect(fixture.catalog.getSourceById(firstSource.id)).resolves.toMatchObject({
      sourceKey: firstSource.sourceKey,
    });
    await expect(fixture.catalog.getDocumentById(document!.id)).resolves.toMatchObject({
      id: document!.id,
    });

    const sections = await fixture.catalog.listCurrentDocumentSectionsPage({
      offset: 0,
      limit: 3,
      sourceKey: firstSource.sourceKey,
    });
    expect(sections).toMatchObject({ offset: 0, limit: 3, total: 10 });
    const section = sections.items[0]?.section;
    expect(section).toBeDefined();
    await expect(fixture.catalog.getCurrentDocumentSectionById(section!.id)).resolves.toMatchObject(
      {
        section: { id: section!.id },
      },
    );

    await expect(fixture.catalog.countSources()).resolves.toBe(2);
    await expect(fixture.catalog.countSources(true)).resolves.toBe(2);
    await expect(fixture.catalog.countDocuments({ language: 'fr' })).resolves.toBe(4);
    await expect(fixture.catalog.countCurrentDocumentSections({ status: 'ACTIVE' })).resolves.toBe(
      12,
    );
    await expect(fixture.catalog.listSourcesPage({ offset: 1, limit: 1 })).resolves.toMatchObject({
      offset: 1,
      limit: 1,
      total: 2,
      items: [{ id: secondSource.id }],
    });
    await expect(
      fixture.catalog.listDocumentVersionsPage(document!.id, { offset: 0, limit: 1 }),
    ).resolves.toMatchObject({
      offset: 0,
      limit: 1,
      total: 1,
      items: [{ documentId: document!.id }],
    });
    await expect(
      fixture.catalog.listDocumentsPage({ offset: 0, limit: MAX_CATALOG_PAGE_SIZE + 1 }),
    ).rejects.toThrow('CATALOG_PAGE_LIMIT_INVALID');
  });

  it('uses primary-key and measured filter indexes in production queries', () => {
    const fixture = createCatalogRepository();
    const database = new Database(fixture.path, { readonly: true });
    try {
      expect(queryPlan(database, SELECT_CATALOG_SOURCE_BY_ID_SQL, [1])).toContain(
        'SEARCH catalog_sources USING INTEGER PRIMARY KEY',
      );
      expect(queryPlan(database, SELECT_DOCUMENT_BY_ID_SQL, [1])).toContain(
        'SEARCH documents USING INTEGER PRIMARY KEY',
      );
      expect(queryPlan(database, SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL, [1])).toContain(
        'SEARCH document_sections USING INTEGER PRIMARY KEY',
      );

      const languagePage = createDocumentEntriesPageSql({ offset: 0, limit: 20, language: 'fr' });
      expect(queryPlan(database, languagePage.sql, languagePage.parameters)).toContain(
        'SEARCH documents USING INDEX ix_documents_language_id',
      );
    } finally {
      database.close();
    }
  });
});

function createCatalogRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-pagination-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const catalog = new SqliteCatalogRepository(path, { now: () => new Date(1_000) });
  catalogs.push(catalog);
  return { catalog, path };
}

async function addSource(catalog: SqliteCatalogRepository, sourceKey: string) {
  return catalog.addSource({
    sourceKey,
    displayName: sourceKey,
    baseUrl: `https://${sourceKey}.example.test/`,
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
}

async function addDocument(
  catalog: SqliteCatalogRepository,
  input: {
    readonly sourceId: number;
    readonly sourceKey: string;
    readonly index: number;
    readonly language: string;
    readonly status: DocumentStatus;
  },
) {
  return catalog.commitDocumentRevision({
    document: {
      publicId: `${input.sourceKey}-document-${input.index}`,
      sourceId: input.sourceId,
      canonicalUrl: `https://${input.sourceKey}.example.test/document-${input.index}`,
      stableKey: `document-${input.index}`,
      title: `Document ${input.index}`,
      mimeType: 'text/markdown',
      language: input.language,
      status: input.status,
    },
    version: {
      contentHash: `version-${input.sourceKey}-${input.index}`,
      extractionMode: 'static',
      contentType: 'text/markdown',
      metadataJson: '{}',
    },
    sections: [0, 1].map((ordinal) => ({
      ordinal,
      heading: `Section ${ordinal}`,
      content: `Document ${input.index} section ${ordinal}`,
      contentHash: `section-${input.sourceKey}-${input.index}-${ordinal}`,
      characterCount: 20,
    })),
  });
}

function queryPlan(
  database: Database.Database,
  sql: string,
  parameters: readonly (string | number)[],
): string {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
    detail: string;
  }[];
  return rows.map(({ detail }) => detail).join('\n');
}
