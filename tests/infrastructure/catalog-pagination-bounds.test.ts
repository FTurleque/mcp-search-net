import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { SqliteCatalogReadModel } from '../../src/infrastructure/catalog/sqlite-catalog-read-model.js';

describe('catalog pagination bounds', () => {
  it('rejects pathological deep offsets before preparing SQL', () => {
    const readModel = new SqliteCatalogReadModel({} as Database.Database);

    expect(() =>
      readModel.listDocumentsPage({ offset: 1_000_001, limit: 20 }),
    ).toThrow('CATALOG_PAGE_OFFSET_INVALID');
    expect(() =>
      readModel.listCurrentDocumentSectionsPage({
        offset: 1_000_001,
        limit: 20,
      }),
    ).toThrow('CATALOG_PAGE_OFFSET_INVALID');
    expect(() =>
      readModel.listDocumentVersionsPage(1, { offset: 1_000_001, limit: 20 }),
    ).toThrow('CATALOG_PAGE_OFFSET_INVALID');
  });
});
