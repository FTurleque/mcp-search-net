import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MAX_CATALOG_PAGE_OFFSET } from '../../src/application/ports/catalog-repository.js';
import { InvalidArgumentError } from '../../src/domain/errors/domain-errors.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function createCatalogRepository(): SqliteCatalogRepository {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-pagination-bounds-'));
  roots.push(root);
  const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), {
    now: () => new Date(0),
  });
  catalogs.push(catalog);
  return catalog;
}

describe('catalog pagination bounds', () => {
  it('rejects pathological deep offsets before preparing SQL', async () => {
    const catalog = createCatalogRepository();

    await expect(catalog.listDocumentsPage({ offset: 1_000_001, limit: 20 })).rejects.toThrow(
      'CATALOG_PAGE_OFFSET_INVALID',
    );
    await expect(
      catalog.listCurrentDocumentSectionsPage({ offset: 1_000_001, limit: 20 }),
    ).rejects.toThrow('CATALOG_PAGE_OFFSET_INVALID');
    await expect(
      catalog.listDocumentVersionsPage(1, { offset: 1_000_001, limit: 20 }),
    ).rejects.toThrow('CATALOG_PAGE_OFFSET_INVALID');
  });

  it('reports offset overflows as INVALID_ARGUMENT, never as an internal error', async () => {
    const catalog = createCatalogRepository();

    await expect(
      catalog.listDocumentsPage({ offset: MAX_CATALOG_PAGE_OFFSET + 1, limit: 20 }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(
      catalog.listDocumentsPage({ offset: MAX_CATALOG_PAGE_OFFSET + 1, limit: 20 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it.each([
    ['zero', 0, false],
    ['the max', MAX_CATALOG_PAGE_OFFSET, false],
    ['max + 1', MAX_CATALOG_PAGE_OFFSET + 1, true],
    ['negative', -1, true],
    ['non-integer', 1.5, true],
  ] as const)(
    'documents pagination: offset %s (%s) rejects=%s',
    async (_label, offset, shouldReject) => {
      const catalog = createCatalogRepository();
      const page = catalog.listDocumentsPage({ offset, limit: 20 });
      if (shouldReject) {
        await expect(page).rejects.toBeInstanceOf(InvalidArgumentError);
      } else {
        await expect(page).resolves.toMatchObject({ offset, limit: 20, total: 0, items: [] });
      }
    },
  );

  it.each([
    ['zero', 0, false],
    ['the max', MAX_CATALOG_PAGE_OFFSET, false],
    ['max + 1', MAX_CATALOG_PAGE_OFFSET + 1, true],
    ['negative', -1, true],
    ['non-integer', 1.5, true],
  ] as const)(
    'sources pagination: offset %s (%s) rejects=%s',
    async (_label, offset, shouldReject) => {
      const catalog = createCatalogRepository();
      const page = catalog.listSourcesPage({ offset, limit: 20 });
      if (shouldReject) {
        await expect(page).rejects.toBeInstanceOf(InvalidArgumentError);
        await expect(page).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      } else {
        await expect(page).resolves.toMatchObject({ offset, limit: 20, total: 0, items: [] });
      }
    },
  );

  it('sources pagination rejects offsets beyond the shared maximum with a stable message', async () => {
    const catalog = createCatalogRepository();

    await expect(
      catalog.listSourcesPage({ offset: MAX_CATALOG_PAGE_OFFSET + 1, limit: 20 }),
    ).rejects.toThrow('CATALOG_PAGE_OFFSET_INVALID');
  });

  it.each([
    ['zero', 0, false],
    ['the max', MAX_CATALOG_PAGE_OFFSET, false],
    ['max + 1', MAX_CATALOG_PAGE_OFFSET + 1, true],
  ] as const)(
    'document versions pagination: offset %s (%s) rejects=%s',
    async (_label, offset, shouldReject) => {
      const catalog = createCatalogRepository();
      const page = catalog.listDocumentVersionsPage(1, { offset, limit: 20 });
      if (shouldReject) {
        await expect(page).rejects.toBeInstanceOf(InvalidArgumentError);
      } else {
        await expect(page).resolves.toMatchObject({ offset, limit: 20, total: 0, items: [] });
      }
    },
  );
});
