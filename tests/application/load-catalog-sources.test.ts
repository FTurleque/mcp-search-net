import { describe, expect, it } from 'vitest';

import { LoadCatalogSources } from '../../src/application/use-cases/load-catalog-sources.js';
import type { CatalogSource, NewCatalogSource } from '../../src/domain/models/catalog.js';

class CatalogSourceRepositoryStub {
  private nextId = 1;
  private readonly sources = new Map<string, CatalogSource>();

  public async addSource(source: NewCatalogSource): Promise<CatalogSource> {
    const createdSource: CatalogSource = {
      id: this.nextId,
      ...source,
      createdAt: new Date(1_000),
      updatedAt: new Date(1_000),
    };
    this.nextId += 1;
    this.sources.set(source.sourceKey, createdSource);
    return createdSource;
  }

  public async getSourceByKey(sourceKey: string): Promise<CatalogSource | undefined> {
    return this.sources.get(sourceKey);
  }
}

describe('LoadCatalogSources', () => {
  it('creates missing sources and skips existing ones', async () => {
    const repository = new CatalogSourceRepositoryStub();
    await repository.addSource({
      sourceKey: 'existing',
      displayName: 'Existing',
      baseUrl: 'https://example.test/existing/',
      sourceType: 'documentation',
      language: 'fr',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });

    const result = await new LoadCatalogSources(repository).execute({
      sources: [
        {
          sourceKey: 'existing',
          displayName: 'Existing',
          baseUrl: 'https://example.test/existing/',
          sourceType: 'documentation',
          language: 'fr',
          freshnessPolicy: 'manual',
          syncStrategy: 'manual',
          enabled: true,
        },
        {
          sourceKey: 'new-docs',
          displayName: 'New docs',
          baseUrl: 'https://example.test/new/',
          sourceType: 'guide',
          language: 'en-US',
          freshnessPolicy: 'weekly',
          syncStrategy: 'manual',
          enabled: true,
        },
      ],
    });

    expect(result).toEqual({
      schemaVersion: '1.0',
      createdCount: 1,
      skippedCount: 1,
      sources: [
        {
          sourceKey: 'existing',
          status: 'skipped',
          id: 1,
        },
        {
          sourceKey: 'new-docs',
          status: 'created',
          id: 2,
        },
      ],
    });
  });
});
