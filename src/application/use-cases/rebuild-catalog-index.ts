import type { CatalogRepository } from '../ports/catalog-repository.js';

export interface RebuildCatalogIndexOutput {
  readonly schemaVersion: '1.0';
  readonly status: 'rebuilt';
  readonly indexedSections: number;
}

export class RebuildCatalogIndex {
  public constructor(private readonly repository: Pick<CatalogRepository, 'rebuildSearchIndex'>) {}

  public async execute(): Promise<RebuildCatalogIndexOutput> {
    const result = await this.repository.rebuildSearchIndex();
    return {
      schemaVersion: '1.0',
      status: 'rebuilt',
      indexedSections: result.indexedSections,
    };
  }
}
