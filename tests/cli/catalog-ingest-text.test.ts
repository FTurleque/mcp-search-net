import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ingestTextDocument, splitMarkdownSections } from '../../src/cli/catalog-ingest-text.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
});

describe('catalog text ingestion', () => {
  it('keeps a document without headings in one section', () => {
    expect(splitMarkdownSections('Guide', 'Introduction.\n\nInstall with npm.')).toMatchObject([
      {
        ordinal: 0,
        heading: 'Guide',
        headingPath: 'Guide',
        headingLevel: 1,
        anchor: 'document',
        content: 'Introduction.\n\nInstall with npm.',
      },
    ]);
  });

  it('preserves the preamble before the first heading', () => {
    const sections = splitMarkdownSections(
      'Guide',
      'Introduction before the first heading.\n\n# Installation\n\nRun npm install.',
    );

    expect(sections).toMatchObject([
      {
        ordinal: 0,
        heading: 'Guide',
        anchor: 'document',
        content: 'Introduction before the first heading.',
      },
      {
        ordinal: 1,
        heading: 'Installation',
        headingPath: 'Installation',
        anchor: 'installation',
        content: '# Installation\n\nRun npm install.',
      },
    ]);
  });

  it('splits markdown content into heading sections', () => {
    const sections = splitMarkdownSections(
      'Guide',
      [
        '# Guide',
        '',
        'Intro.',
        '## Install',
        '',
        'Run npm install.',
        '## Usage',
        '',
        'Run it.',
      ].join('\n'),
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

  it('keeps nested heading paths after a preamble section', () => {
    const sections = splitMarkdownSections(
      'Guide',
      'Preamble.\n\n# Guide\n\nIntro.\n## Install\n\nSteps.\n### Windows\n\nDetails.',
    );

    expect(sections).toMatchObject([
      { ordinal: 0, heading: 'Guide', headingPath: 'Guide', anchor: 'document' },
      { ordinal: 1, heading: 'Guide', headingPath: 'Guide', anchor: 'guide' },
      { ordinal: 2, heading: 'Install', headingPath: 'Guide > Install', anchor: 'install' },
      {
        ordinal: 3,
        heading: 'Windows',
        headingPath: 'Guide > Install > Windows',
        anchor: 'windows',
      },
    ]);
  });

  it.each(['', '   ', '\r\n\r\n'])('keeps an empty document representable', (content) => {
    expect(splitMarkdownSections('Empty', content)).toMatchObject([
      {
        ordinal: 0,
        heading: 'Empty',
        anchor: 'document',
        content,
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
      .prepare(
        'SELECT ordinal, heading, heading_path, anchor FROM document_sections ORDER BY ordinal',
      )
      .all() as { ordinal: number; heading: string; heading_path: string; anchor: string }[];
    expect(rows).toEqual([
      { ordinal: 0, heading: 'Guide', heading_path: 'Guide', anchor: 'guide' },
      { ordinal: 1, heading: 'Usage', heading_path: 'Guide > Usage', anchor: 'usage' },
    ]);
    database.close();

    await expect(fixture.catalog.searchDocuments({ query: 'run it' })).resolves.toMatchObject([
      {
        document: { publicId: result.document.publicId },
        section: { heading: 'Usage' },
      },
    ]);
  });
});

function createCatalogRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-ingest-'));
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date(1_000) };
  const catalog = new SqliteCatalogRepository(path, clock);
  catalogs.push(catalog);
  return { catalog, path, root };
}
