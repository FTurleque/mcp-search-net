import { describe, expect, it } from 'vitest';

import { PlanCatalogSync } from '../../src/application/use-cases/plan-catalog-sync.js';
import type {
  CatalogDocument,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunCompletionInput,
  CatalogSyncRunStartInput,
} from '../../src/domain/models/catalog.js';

class SyncPlanRepositoryStub {
  private nextRunId = 1;
  private readonly runs = new Map<number, CatalogSyncRun>();

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

  public async startCatalogSyncRun(input: CatalogSyncRunStartInput): Promise<CatalogSyncRun> {
    const syncRun: CatalogSyncRun = {
      id: this.nextRunId,
      ...input,
      status: 'RUNNING',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
    };
    this.runs.set(syncRun.id, syncRun);
    this.nextRunId += 1;
    return syncRun;
  }

  public async completeCatalogSyncRun(
    syncRunId: number,
    input: CatalogSyncRunCompletionInput,
  ): Promise<CatalogSyncRun> {
    const running = this.runs.get(syncRunId);
    if (running === undefined) throw new Error('RUN_NOT_FOUND');
    const syncRun = { ...running, ...input };
    this.runs.set(syncRunId, syncRun);
    return syncRun;
  }
}

describe('PlanCatalogSync', () => {
  it('plans enabled sources and skips disabled sources', async () => {
    const repository = new SyncPlanRepositoryStub(
      [enabledSource, disabledSource],
      [documentFor(enabledSource.id, 1), documentFor(enabledSource.id, 2)],
    );

    const result = await new PlanCatalogSync(repository, fixedClock).execute({});

    expect(result.syncRun).toEqual({
      id: 1,
      runKind: 'PLAN',
      startedAt: now,
      completedAt: now,
      status: 'CANCELLED',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
      errorSummary: 'DRY_RUN_PLAN',
    });
    expect(result).toMatchObject({
      schemaVersion: '1.0',
      dryRun: true,
      plannedCount: 1,
      skippedCount: 1,
      plannedDocumentCount: 0,
      skippedDocumentCount: 0,
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
          configuredDocumentCount: 0,
          documents: [],
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
          configuredDocumentCount: 0,
          documents: [],
        },
      ],
    });
  });

  it('keeps planned document counts separate from execution metrics', async () => {
    const repository = new SyncPlanRepositoryStub([enabledSource], []);

    const result = await new PlanCatalogSync(repository, fixedClock).execute({
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'intro',
          title: 'Introduction',
          url: 'https://docs.example/enabled/intro.html',
          language: 'en-US',
          mimeType: 'text/html',
          enabled: true,
        },
        {
          sourceKey: 'enabled-docs',
          stableKey: 'disabled',
          title: 'Disabled',
          url: 'https://docs.example/enabled/disabled.html',
          language: 'en-US',
          mimeType: 'text/html',
          enabled: false,
        },
      ],
    });

    expect(result.plannedDocumentCount).toBe(1);
    expect(result.skippedDocumentCount).toBe(1);
    expect(result.syncRun).toMatchObject({
      runKind: 'PLAN',
      status: 'CANCELLED',
      documentsChecked: 0,
      errorSummary: 'DRY_RUN_PLAN',
    });
    expect(result.sources[0]?.configuredDocumentCount).toBe(2);
    expect(result.sources[0]?.documents).toEqual([
      {
        stableKey: 'intro',
        title: 'Introduction',
        url: 'https://docs.example/enabled/intro.html',
        language: 'en-US',
        mimeType: 'text/html',
        enabled: true,
        status: 'planned',
      },
      {
        stableKey: 'disabled',
        title: 'Disabled',
        url: 'https://docs.example/enabled/disabled.html',
        language: 'en-US',
        mimeType: 'text/html',
        enabled: false,
        status: 'skipped',
        reason: 'DISABLED',
      },
    ]);
  });

  it('filters by source key and stores the source id on the sync run', async () => {
    const repository = new SyncPlanRepositoryStub(
      [enabledSource, disabledSource],
      [documentFor(enabledSource.id, 1)],
    );

    const result = await new PlanCatalogSync(repository, fixedClock).execute({
      sourceKey: 'enabled-docs',
    });

    expect(result.syncRun).toMatchObject({
      id: 1,
      sourceId: enabledSource.id,
      runKind: 'PLAN',
      status: 'CANCELLED',
      errorSummary: 'DRY_RUN_PLAN',
    });
    expect(result.plannedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceKey: 'enabled-docs',
      currentDocumentCount: 1,
    });
  });

  it('captures planning start before completion when the clock advances', async () => {
    const repository = new SyncPlanRepositoryStub([enabledSource], []);
    const moments = [new Date(1_000), new Date(2_000)];

    const result = await new PlanCatalogSync(repository, {
      now: () => moments.shift() ?? new Date(2_000),
    }).execute({});

    expect(result.syncRun).toMatchObject({
      runKind: 'PLAN',
      startedAt: new Date(1_000),
      completedAt: new Date(2_000),
      status: 'CANCELLED',
      errorSummary: 'DRY_RUN_PLAN',
    });
  });

  it('fails when a filtered source does not exist', async () => {
    const repository = new SyncPlanRepositoryStub([enabledSource], []);

    await expect(
      new PlanCatalogSync(repository, fixedClock).execute({ sourceKey: 'missing-docs' }),
    ).rejects.toThrow('Catalog source missing-docs was not found');
  });
});

const now = new Date(1_000);
const fixedClock = { now: () => now };

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
