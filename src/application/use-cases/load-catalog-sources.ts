import type { CatalogSource, NewCatalogSource } from '../../domain/models/catalog.js';
import type { CatalogRepository } from '../ports/catalog-repository.js';

export type CatalogSourceLoadStatus = 'created' | 'updated' | 'skipped';

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
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly sources: readonly CatalogSourceLoadEntry[];
}

export class LoadCatalogSources {
  public constructor(
    private readonly repository: Pick<
      CatalogRepository,
      'addSource' | 'updateSource' | 'getSourceByKey' | 'rebuildSearchIndex'
    >,
  ) {}

  public async execute(input: LoadCatalogSourcesInput): Promise<LoadCatalogSourcesOutput> {
    const entries: CatalogSourceLoadEntry[] = [];

    for (const source of input.sources) {
      const existingSource = await this.repository.getSourceByKey(source.sourceKey);
      if (existingSource !== undefined) {
        if (sourceConfigurationMatches(existingSource, source)) {
          entries.push({
            sourceKey: existingSource.sourceKey,
            status: 'skipped',
            id: existingSource.id,
          });
        } else {
          const updatedSource = await this.repository.updateSource(source);
          entries.push({
            sourceKey: updatedSource.sourceKey,
            status: 'updated',
            id: updatedSource.id,
          });
        }
        continue;
      }

      const createdSource = await this.repository.addSource(source);
      entries.push({
        sourceKey: createdSource.sourceKey,
        status: 'created',
        id: createdSource.id,
      });
    }

    const updatedCount = entries.filter((entry) => entry.status === 'updated').length;
    if (updatedCount > 0) await this.repository.rebuildSearchIndex();

    return {
      schemaVersion: '1.0',
      createdCount: entries.filter((entry) => entry.status === 'created').length,
      updatedCount,
      skippedCount: entries.filter((entry) => entry.status === 'skipped').length,
      sources: entries,
    };
  }
}

function sourceConfigurationMatches(existing: CatalogSource, desired: NewCatalogSource): boolean {
  return (
    existing.sourceKey === desired.sourceKey &&
    existing.displayName === desired.displayName &&
    existing.baseUrl === desired.baseUrl &&
    existing.sourceType === desired.sourceType &&
    existing.language === desired.language &&
    existing.freshnessPolicy === desired.freshnessPolicy &&
    existing.syncStrategy === desired.syncStrategy &&
    existing.enabled === desired.enabled
  );
}
