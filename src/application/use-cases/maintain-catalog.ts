export interface CatalogMaintenanceInput {
  readonly keepSyncRuns: number;
  readonly maxSyncRunAgeDays: number;
  readonly vacuum: boolean;
  readonly staleLockMs: number;
}

export interface CatalogMaintenanceOutput {
  readonly schemaVersion: '1.0';
  readonly status: 'maintained';
  readonly lock: {
    readonly acquired: true;
    readonly path: string;
  };
  readonly retention: {
    readonly keepSyncRuns: number;
    readonly maxSyncRunAgeDays: number;
    readonly syncRunsBefore: number;
    readonly syncRunsDeleted: number;
    readonly syncRunsAfter: number;
  };
  readonly sqlite: {
    readonly analyzed: boolean;
    readonly optimized: boolean;
    readonly walCheckpointed: boolean;
    readonly vacuumed: boolean;
  };
  readonly durationMs: number;
}

export interface CatalogMaintenanceRunner {
  run(input: CatalogMaintenanceInput): Promise<CatalogMaintenanceOutput>;
}

export class MaintainCatalog {
  public constructor(private readonly runner: CatalogMaintenanceRunner) {}

  public async execute(input: CatalogMaintenanceInput): Promise<CatalogMaintenanceOutput> {
    if (!Number.isSafeInteger(input.keepSyncRuns) || input.keepSyncRuns < 0) {
      throw new Error('keepSyncRuns must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(input.maxSyncRunAgeDays) || input.maxSyncRunAgeDays < 0) {
      throw new Error('maxSyncRunAgeDays must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(input.staleLockMs) || input.staleLockMs <= 0) {
      throw new Error('staleLockMs must be a positive safe integer');
    }

    return this.runner.run(input);
  }
}
