import { describe, expect, it } from 'vitest';

import { LoadCatalogSources } from '../../src/application/use-cases/load-catalog-sources.js';
import type { CatalogSource, NewCatalogSource } from '../../src/domain/models/catalog.js';

class CatalogSourceRepositoryStub {
  private nextId = 1;
  private readonly sources = new Map<string, CatalogSource>();
  public rebuildCount = 0;

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

  public async updateSource(source: NewCatalogSource): Promise<CatalogSource> {
    const existing = this.sources.get(source.sourceKey);
    if (existing === undefined) throw new Error('source missing');
    const updated: CatalogSource = {
      ...existing,
      ...source,
      updatedAt: new Date(2_000),
    };
    this.sources.set(source.sourceKey, updated);
    return updated;
  }

  public async getSourceByKey(sourceKey: string): Promise<CatalogSource | undefined> {
    return this.sources.get(sourceKey);
  }

  public async rebuildSearchIndex(): Promise<{ indexedSections: number }> {
    this.rebuildCount += 1;
    return { indexedSections: 0 };
  }
}

describe('LoadCatalogSources', () => {
  it('creates missing sources and skips unchanged existing ones', async () => {
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
      updatedCount: 0,
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
    expect(repository.rebuildCount).toBe(0);
  });

  it('reconciles changed source configuration and rebuilds the derived search index', async () => {
    const repository = new CatalogSourceRepositoryStub();
    await repository.addSource({
      sourceKey: 'docs',
      displayName: 'Old docs',
      baseUrl: 'https://example.test/old/',
      sourceType: 'documentation',
      language: 'fr',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });

    const result = await new LoadCatalogSources(repository).execute({
      sources: [
        {
          sourceKey: 'docs',
          displayName: 'Current docs',
          baseUrl: 'https://example.test/current/',
          sourceType: 'reference',
          language: 'en-US',
          freshnessPolicy: 'daily',
          syncStrategy: 'polling',
          enabled: false,
        },
      ],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.sources).toEqual([{ sourceKey: 'docs', status: 'updated', id: 1 }]);
    expect(await repository.getSourceByKey('docs')).toMatchObject({
      displayName: 'Current docs',
      baseUrl: 'https://example.test/current/',
      sourceType: 'reference',
      language: 'en-US',
      freshnessPolicy: 'daily',
      syncStrategy: 'polling',
      enabled: false,
    });
    expect(repository.rebuildCount).toBe(1);
  });
});
