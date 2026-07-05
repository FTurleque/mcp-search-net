import { describe, expect, it } from 'vitest';

import {
  MaintainCatalog,
  type CatalogMaintenanceInput,
  type CatalogMaintenanceOutput,
  type CatalogMaintenanceRunner,
} from '../../src/application/use-cases/maintain-catalog.js';

class RecordingMaintenanceRunner implements CatalogMaintenanceRunner {
  public input?: CatalogMaintenanceInput;

  public async run(input: CatalogMaintenanceInput): Promise<CatalogMaintenanceOutput> {
    this.input = input;
    return {
      schemaVersion: '1.0',
      status: 'maintained',
      lock: { acquired: true, path: 'catalog-maintenance.lock' },
      retention: {
        keepSyncRuns: input.keepSyncRuns,
        maxSyncRunAgeDays: input.maxSyncRunAgeDays,
        syncRunsBefore: 3,
        syncRunsDeleted: 1,
        syncRunsAfter: 2,
      },
      sqlite: {
        analyzed: true,
        optimized: true,
        walCheckpointed: true,
        vacuumed: input.vacuum,
      },
      durationMs: 12,
    };
  }
}

describe('MaintainCatalog', () => {
  it('delegates validated maintenance input to the runner', async () => {
    const runner = new RecordingMaintenanceRunner();
    const input: CatalogMaintenanceInput = {
      keepSyncRuns: 25,
      maxSyncRunAgeDays: 30,
      vacuum: false,
      staleLockMs: 60_000,
    };

    const result = await new MaintainCatalog(runner).execute(input);

    expect(runner.input).toEqual(input);
    expect(result.retention.syncRunsDeleted).toBe(1);
    expect(result.sqlite.optimized).toBe(true);
    expect(result.lock.acquired).toBe(true);
  });

  it('rejects invalid retention settings before calling the runner', async () => {
    const runner = new RecordingMaintenanceRunner();

    await expect(
      new MaintainCatalog(runner).execute({
        keepSyncRuns: -1,
        maxSyncRunAgeDays: 30,
        vacuum: false,
        staleLockMs: 60_000,
      }),
    ).rejects.toThrow('keepSyncRuns must be a non-negative safe integer');

    expect(runner.input).toBeUndefined();
  });
});
