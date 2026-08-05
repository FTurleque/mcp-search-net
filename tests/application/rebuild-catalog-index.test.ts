import { describe, expect, it } from 'vitest';

import { RebuildCatalogIndex } from '../../src/application/use-cases/rebuild-catalog-index.js';

class RebuildOnlyCatalogRepository {
  public calls = 0;

  public async rebuildSearchIndex(): Promise<{ readonly indexedSections: number }> {
    this.calls += 1;
    return { indexedSections: 12 };
  }
}

describe('RebuildCatalogIndex', () => {
  it('rebuilds the catalog search index and returns a stable response', async () => {
    const repository = new RebuildOnlyCatalogRepository();

    const result = await new RebuildCatalogIndex(repository).execute();

    expect(repository.calls).toBe(1);
    expect(result).toEqual({
      schemaVersion: '1.0',
      status: 'rebuilt',
      indexedSections: 12,
    });
  });
});
