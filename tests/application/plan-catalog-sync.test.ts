import { describe, expect, it } from 'vitest';

import { PlanCatalogSync } from '../../src/application/use-cases/plan-catalog-sync.js';
import type { CatalogDocument, CatalogSource } from '../../src/domain/models/catalog.js';

class SyncPlanRepositoryStub {
  public constructor(
    private readonly sources: readonly CatalogSource[],
    private readonly documents: readonly CatalogDocument[],
  ) {}

  public async listSources(): Promise<readonly CatalogSource[]> {
    return this.sources;
  }

  public async listDocuments(): Promise<readonly CatalogDocument[]> {
    return this.documents;
  }
}

describe('PlanCatalogSync', () => {
  it('plans enabled sources and skips disabled sources', async () => {
    const repository = new SyncPlanRepositoryStub(
      [enabledSource, disabledSource],
      [documentFor(enabledSource.id, 1), documentFor(enabledSource.id, 2)],
    );

    const result = await new PlanCatalogSync(repository).execute({});

    expect(result).toEqual({
      schemaVersion: '1.0',
      dryRun: true,
      plannedCount: 1,
      skippedCount: 1,
      sources: [
        {
          sourceKey: 'enabled-docs',
          displayName: 'Enabled Documentation',
          baseUrl: 'https://docs.example/enabled/',
          language: 'en-US',
          freshnessPolicy: 'weekly',
          syncStrategy: 'manual',
          enabled: true,
          status: 'planned',
          currentDocumentCount: 2,
        },
        {
          sourceKey: 'disabled-docs',
          displayName: 'Disabled Documentation',
          baseUrl: 'https://docs.example/disabled/',
          language: 'fr',
          freshnessPolicy: 'manual',
          syncStrategy: 'manual',
          enabled: false,
          status: 'skipped',
          reason: 'DISABLED',
          currentDocumentCount: 0,
        },
      ],
    });
  });

  it('filters by source key', async () => {
    const repository = new SyncPlanRepositoryStub(
      [enabledSource, disabledSource],
      [documentFor(enabledSource.id, 1)],
    );

    const result = await new PlanCatalogSync(repository).execute({ sourceKey: 'enabled-docs' });

    expect(result.plannedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceKey: 'enabled-docs',
      currentDocumentCount: 1,
    });
  });

  it('fails when a filtered source does not exist', async () => {
    const repository = new SyncPlanRepositoryStub([enabledSource], []);

    await expect(
      new PlanCatalogSync(repository).execute({ sourceKey: 'missing-docs' }),
    ).rejects.toThrow('Catalog source missing-docs was not found');
  });
});

const now = new Date(1_000);

const enabledSource: CatalogSource = {
  id: 1,
  sourceKey: 'enabled-docs',
  displayName: 'Enabled Documentation',
  baseUrl: 'https://docs.example/enabled/',
  sourceType: 'documentation',
  language: 'en-US',
  freshnessPolicy: 'weekly',
  syncStrategy: 'manual',
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const disabledSource: CatalogSource = {
  id: 2,
  sourceKey: 'disabled-docs',
  displayName: 'Disabled Documentation',
  baseUrl: 'https://docs.example/disabled/',
  sourceType: 'documentation',
  language: 'fr',
  freshnessPolicy: 'manual',
  syncStrategy: 'manual',
  enabled: false,
  createdAt: now,
  updatedAt: now,
};

function documentFor(sourceId: number, index: number): CatalogDocument {
  return {
    id: index,
    publicId: `doc-${index}`,
    sourceId,
    canonicalUrl: `https://docs.example/doc-${index}.html`,
    stableKey: `doc-${index}`,
    title: `Document ${index}`,
    mimeType: 'text/html',
    language: 'en-US',
    status: 'ACTIVE',
    currentVersionId: index,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
