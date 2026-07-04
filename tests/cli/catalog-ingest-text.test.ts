import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { ingestTextDocument, splitMarkdownSections } from '../../src/cli/catalog-ingest-text.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog text ingestion', () => {
  it('splits markdown content into heading sections', () => {
    const sections = splitMarkdownSections(
      'Guide',
      ['# Guide', '', 'Intro.', '## Install', '', 'Run npm install.', '## Usage', '', 'Run it.'].join('\n'),
    );

    expect(sections).toMatchObject([
      {
        ordinal: 0,
        heading: 'Guide',
        headingPath: 'Guide',
        headingLevel: 1,
        anchor: 'guide',
      },
      {
        ordinal: 1,
        heading: 'Install',
        headingPath: 'Guide > Install',
        headingLevel: 2,
        anchor: 'install',
      },
      {
        ordinal: 2,
        heading: 'Usage',
        headingPath: 'Guide > Usage',
        headingLevel: 2,
        anchor: 'usage',
      },
    ]);
  });

  it('ingests a text document into document, version and sections tables', async () => {
    const fixture = createCatalogRepository();
    await fixture.catalog.addSource({
      sourceKey: 'local-docs',
      displayName: 'Local docs',
      baseUrl: 'https://example.test/docs/',
      sourceType: 'documentation',
      language: 'fr',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const filePath = join(fixture.root, 'guide.md');
    await writeFile(filePath, '# Guide\n\nIntro.\n## Usage\n\nRun it.\n', 'utf8');

    const result = await ingestTextDocument(fixture.catalog, {
      sourceKey: 'local-docs',
      filePath,
      canonicalUrl: 'https://example.test/docs/guide',
      title: 'Guide',
      language: 'fr',
      mimeType: 'text/markdown',
      versionLabel: 'v1',
    });

    expect(result.sectionCount).toBe(2);
    expect(result.document).toMatchObject({
      title: 'Guide',
      canonicalUrl: 'https://example.test/docs/guide',
      status: 'ACTIVE',
    });
    expect(result.version).toMatchObject({
      isCurrent: true,
      versionLabel: 'v1',
      extractionMode: 'static',
      contentType: 'text/markdown',
    });

    const database = new Database(fixture.path, { readonly: true });
    const rows = database
      .prepare('SELECT ordinal, heading, heading_path, anchor FROM document_sections ORDER BY ordinal')
      .all() as {
      ordinal: number;
      heading: string;
      heading_path: string;
      anchor: string;
    }[];
    expect(rows).toEqual([
      { ordinal: 0, heading: 'Guide', heading_path: 'Guide', anchor: 'guide' },
      { ordinal: 1, heading: 'Usage', heading_path: 'Guide > Usage', anchor: 'usage' },
    ]);
    database.close();
  });
});

function createCatalogRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-ingest-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date(1_000) };
  const catalog = new SqliteCatalogRepository(path, clock);
  catalogs.push(catalog);
  return { catalog, path, root };
}
