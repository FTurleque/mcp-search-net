import type { CatalogRepository } from '../ports/catalog-repository.js';
import type { NewCatalogSource } from '../../domain/models/catalog.js';

export type CatalogSourceLoadStatus = 'created' | 'skipped';

export interface CatalogSourceLoadEntry {
  readonly sourceKey: string;
  readonly status: CatalogSourceLoadStatus;
  readonly id: number;
}

export interface LoadCatalogSourcesInput {
  readonly sources: readonly NewCatalogSource[];
}

export interface LoadCatalogSourcesOutput {
  readonly schemaVersion: '1.0';
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly sources: readonly CatalogSourceLoadEntry[];
}

export class LoadCatalogSources {
  public constructor(
    private readonly repository: Pick<CatalogRepository, 'addSource' | 'getSourceByKey'>,
  ) {}

  public async execute(input: LoadCatalogSourcesInput): Promise<LoadCatalogSourcesOutput> {
    const entries: CatalogSourceLoadEntry[] = [];

    for (const source of input.sources) {
      const existingSource = await this.repository.getSourceByKey(source.sourceKey);
      if (existingSource !== undefined) {
        entries.push({
          sourceKey: existingSource.sourceKey,
          status: 'skipped',
          id: existingSource.id,
        });
        continue;
      }

      const createdSource = await this.repository.addSource(source);
      entries.push({
        sourceKey: createdSource.sourceKey,
        status: 'created',
        id: createdSource.id,
      });
    }

    return {
      schemaVersion: '1.0',
      createdCount: entries.filter((entry) => entry.status === 'created').length,
      skippedCount: entries.filter((entry) => entry.status === 'skipped').length,
      sources: entries,
    };
  }
}
