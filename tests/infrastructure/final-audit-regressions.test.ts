/* eslint-disable @typescript-eslint/no-deprecated -- regression covers the retained legacy two-step revision API */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { decodeSearchCacheValue } from '../../src/application/services/cache-value-validation.js';
import {
  countUnicodeCharacters,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../src/domain/services/bounded-text.js';
import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];
const caches: SqliteCacheRepository[] = [];
const clock = { now: () => new Date(1_000) };

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  caches.splice(0).forEach((cache) => cache.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('final develop audit regressions', () => {
  it('persists pending legacy current-version promotion across repository reopen', async () => {
    const root = createRoot('pending-promotion');
    const path = join(root, 'catalog.db');
    const first = new SqliteCatalogRepository(path, clock);
    catalogs.push(first);
    const source = await first.addSource(sourceInput());
    const document = await first.upsertDocument({
      publicId: 'legacy-two-step',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/legacy-two-step',
      stableKey: 'legacy-two-step',
      title: 'Legacy two-step',
      mimeType: 'text/markdown',
      language: 'en',
      status: 'ACTIVE',
    });
    const staged = await first.addDocumentVersion({
      documentId: document.id,
      contentHash: 'legacy-two-step-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/markdown',
      metadataJson: '{}',
    });
    expect(staged.isCurrent).toBe(false);

    first.close();
    catalogs.splice(catalogs.indexOf(first), 1);
    const reopened = new SqliteCatalogRepository(path, clock);
    catalogs.push(reopened);
    await reopened.replaceDocumentSections(staged.id, [
      {
        ordinal: 0,
        heading: 'Recovered promotion',
        headingPath: 'Recovered promotion',
        content: 'Persisted pending promotion survives a restart.',
        contentHash: 'legacy-two-step-section',
        characterCount: 47,
      },
    ]);

    await expect(reopened.getCurrentDocumentVersion(document.id)).resolves.toMatchObject({
      id: staged.id,
      isCurrent: true,
    });
    await expect(reopened.searchDocuments({ query: 'pending promotion' })).resolves.toHaveLength(1);

    const database = new Database(path, { readonly: true });
    expect(
      database
        .prepare('SELECT is_current, pending_current FROM document_versions WHERE id = ?')
        .get(staged.id),
    ).toEqual({ is_current: 1, pending_current: 0 });
    database.close();
  });

  it('normalizes bounded document titles and rejects invalid identity metadata centrally', async () => {
    const catalog = createCatalog();
    const source = await catalog.addSource(sourceInput());
    const oversizedTitle = '😀'.repeat(MAX_EXTERNAL_TITLE_CHARACTERS + 20);
    const stored = await catalog.upsertDocument({
      publicId: 'bounded-title',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/bounded-title',
      stableKey: 'bounded-title',
      title: oversizedTitle,
      mimeType: 'text/markdown',
      language: 'en-US',
      status: 'ACTIVE',
    });

    expect(countUnicodeCharacters(stored.title)).toBe(MAX_EXTERNAL_TITLE_CHARACTERS);
    await expect(
      catalog.upsertDocument({
        publicId: 'x'.repeat(129),
        sourceId: source.id,
        canonicalUrl: 'https://example.test/invalid-id',
        stableKey: 'invalid-id',
        title: 'Invalid id',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      }),
    ).rejects.toThrow('CATALOG_DOCUMENT_PUBLIC_ID_INVALID');
    await expect(
      catalog.upsertDocument({
        publicId: 'invalid-language',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/invalid-language',
        stableKey: 'invalid-language',
        title: 'Invalid language',
        mimeType: 'text/markdown',
        language: 'x'.repeat(36),
        status: 'ACTIVE',
      }),
    ).rejects.toThrow('CATALOG_DOCUMENT_LANGUAGE_INVALID');
  });

  it('deletes semantically invalid JSON cache entries when a decoder rejects them', async () => {
    const root = createRoot('cache-shape');
    const cache = new SqliteCacheRepository(
      join(root, 'cache.sqlite'),
      clock,
      100,
      1_000_000,
      60_000,
    );
    caches.push(cache);
    await cache.setSearch('shape-key', { syntactically: 'valid', semantically: 'wrong' }, 60_000);

    await expect(
      cache.getSearch('shape-key', { decode: decodeSearchCacheValue }),
    ).resolves.toBeUndefined();
    await expect(cache.getSearch('shape-key')).resolves.toBeUndefined();
  });
});

function createCatalog(): SqliteCatalogRepository {
  const root = createRoot('catalog');
  const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), clock);
  catalogs.push(catalog);
  return catalog;
}

function createRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `mcp-final-audit-${name}-`));
  roots.push(root);
  return root;
}

function sourceInput() {
  return {
    sourceKey: 'docs',
    displayName: 'Documentation',
    baseUrl: 'https://example.test/',
    sourceType: 'documentation' as const,
    language: 'en',
    freshnessPolicy: 'manual' as const,
    syncStrategy: 'manual' as const,
    enabled: true,
  };
}
