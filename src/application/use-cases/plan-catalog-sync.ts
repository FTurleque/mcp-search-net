import type { CatalogSyncRun } from '../../domain/models/catalog.js';
import type { CatalogRepository } from '../ports/catalog-repository.js';
import type { Clock } from '../ports/clock.js';

export type CatalogSyncPlanEntryStatus = 'planned' | 'skipped';

export interface PlanCatalogSyncInput {
  readonly sourceKey?: string;
}

export interface CatalogSyncPlanEntry {
  readonly sourceKey: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly language: string;
  readonly freshnessPolicy: string;
  readonly syncStrategy: string;
  readonly enabled: boolean;
  readonly status: CatalogSyncPlanEntryStatus;
  readonly reason?: 'DISABLED';
  readonly currentDocumentCount: number;
}

export interface PlanCatalogSyncOutput {
  readonly schemaVersion: '1.0';
  readonly dryRun: true;
  readonly syncRun: CatalogSyncRun;
  readonly plannedCount: number;
  readonly skippedCount: number;
  readonly sources: readonly CatalogSyncPlanEntry[];
}

export class PlanCatalogSync {
  public constructor(
    private readonly repository: Pick<
      CatalogRepository,
      'listSources' | 'listDocuments' | 'addCatalogSyncRun'
    >,
    private readonly clock: Clock,
  ) {}

  public async execute(input: PlanCatalogSyncInput): Promise<PlanCatalogSyncOutput> {
    const [sources, documents] = await Promise.all([
      this.repository.listSources(),
      this.repository.listDocuments(),
    ]);
    const selectedSources =
      input.sourceKey === undefined
        ? sources
        : sources.filter((source) => source.sourceKey === input.sourceKey);

    if (input.sourceKey !== undefined && selectedSources.length === 0) {
      throw new Error(`Catalog source ${input.sourceKey} was not found`);
    }

    const entries = selectedSources.map((source): CatalogSyncPlanEntry => {
      const currentDocumentCount = documents.filter((document) => document.sourceId === source.id).length;
      if (!source.enabled) {
        return {
          sourceKey: source.sourceKey,
          displayName: source.displayName,
          baseUrl: source.baseUrl,
          language: source.language,
          freshnessPolicy: source.freshnessPolicy,
          syncStrategy: source.syncStrategy,
          enabled: false,
          status: 'skipped',
          reason: 'DISABLED',
          currentDocumentCount,
        };
      }

      return {
        sourceKey: source.sourceKey,
        displayName: source.displayName,
        baseUrl: source.baseUrl,
        language: source.language,
        freshnessPolicy: source.freshnessPolicy,
        syncStrategy: source.syncStrategy,
        enabled: true,
        status: 'planned',
        currentDocumentCount,
      };
    });

    const plannedCount = entries.filter((entry) => entry.status === 'planned').length;
    const skippedCount = entries.filter((entry) => entry.status === 'skipped').length;
    const now = this.clock.now();
    const syncRun = await this.repository.addCatalogSyncRun({
      ...(selectedSources.length === 1 && selectedSources[0] !== undefined
        ? { sourceId: selectedSources[0].id }
        : {}),
      startedAt: now,
      completedAt: now,
      status: 'SUCCESS',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
    });

    return {
      schemaVersion: '1.0',
      dryRun: true,
      syncRun,
      plannedCount,
      skippedCount,
      sources: entries,
    };
  }
}
