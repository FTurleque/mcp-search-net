import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applicationConfigSchema,
  applicationEnvironmentSchema,
} from '../../src/infrastructure/config/application-config.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('P2/P3 follow-up regressions', () => {
  it('rejects malformed configured URLs without throwing from schema refinements', () => {
    expect(() =>
      applicationEnvironmentSchema.safeParse({ MCP_SEARXNG_URL: 'not-a-url' }),
    ).not.toThrow();
    expect(applicationEnvironmentSchema.safeParse({ MCP_SEARXNG_URL: 'not-a-url' }).success).toBe(
      false,
    );

    expect(() =>
      applicationConfigSchema.safeParse({ crawl4ai: { baseUrl: '://broken' } }),
    ).not.toThrow();
    expect(applicationConfigSchema.safeParse({ crawl4ai: { baseUrl: '://broken' } }).success).toBe(
      false,
    );
  });

  it('updates source visibility and its derived FTS index atomically on success', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource(sourceInput(true));
    await fixture.catalog.commitDocumentRevision({
      document: {
        publicId: 'atomic-guide',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/docs/atomic-guide',
        stableKey: 'atomic-guide',
        title: 'Atomic guide',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'atomic-guide-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          heading: 'Atomic consistency',
          content: 'Searchable atomic consistency content.',
          contentHash: 'atomic-section-v1',
          characterCount: 38,
        },
      ],
    });

    await expect(fixture.catalog.searchDocuments({ query: 'consistency' })).resolves.toHaveLength(
      1,
    );

    await fixture.catalog.updateSource(sourceInput(false));

    await expect(fixture.catalog.getSourceByKey('atomic-docs')).resolves.toMatchObject({
      enabled: false,
    });
    await expect(fixture.catalog.searchDocuments({ query: 'consistency' })).resolves.toEqual([]);
    await expect(fixture.catalog.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
  });

  it('rolls back the source mutation when the FTS rebuild cannot complete', async () => {
    const fixture = createCatalogRepository();
    const source = await fixture.catalog.addSource(sourceInput(true));
    await fixture.catalog.commitDocumentRevision({
      document: {
        publicId: 'rollback-guide',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/docs/rollback-guide',
        stableKey: 'rollback-guide',
        title: 'Rollback guide',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'rollback-guide-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          content: 'Rollback must preserve the source row.',
          contentHash: 'rollback-section-v1',
          characterCount: 38,
        },
      ],
    });

    const destructiveConnection = new Database(fixture.path);
    destructiveConnection.exec('DROP TABLE document_section_fts');
    destructiveConnection.close();

    await expect(fixture.catalog.updateSource(sourceInput(false))).rejects.toThrow(
      /document_section_fts/u,
    );
    await expect(fixture.catalog.getSourceByKey('atomic-docs')).resolves.toMatchObject({
      enabled: true,
    });
  });
});

function sourceInput(enabled: boolean) {
  return {
    sourceKey: 'atomic-docs',
    displayName: 'Atomic docs',
    baseUrl: 'https://example.test/docs/',
    sourceType: 'documentation' as const,
    language: 'en',
    freshnessPolicy: 'manual' as const,
    syncStrategy: 'manual' as const,
    enabled,
  };
}

function createCatalogRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-audit-p2-p3-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date(1_000) };
  const catalog = new SqliteCatalogRepository(path, clock);
  catalogs.push(catalog);
  return { catalog, path };
}
