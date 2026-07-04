import { describe, expect, it } from 'vitest';

import type {
  CatalogVersionPurgeInput,
  CatalogVersionPurgeRepository,
} from '../../src/application/use-cases/purge-catalog-versions.js';
import { PurgeCatalogVersions } from '../../src/application/use-cases/purge-catalog-versions.js';

describe('PurgeCatalogVersions', () => {
  it('uses default retention and rebuilds the index after deleting old versions', async () => {
    const purgeInputs: CatalogVersionPurgeInput[] = [];
    let rebuildCount = 0;
    const repository: CatalogVersionPurgeRepository = {
      purgeOldDocumentVersions: async (input) => {
        purgeInputs.push(input);
        return {
          dryRun: input.dryRun,
          keptPreviousVersions: input.keepPreviousVersions,
          scannedDocuments: 2,
          candidateVersions: 3,
          candidateSections: 7,
          purgedVersions: 3,
          purgedSections: 7,
        };
      },
      rebuildSearchIndex: async () => {
        rebuildCount += 1;
        return { indexedSections: 4 };
      },
    };

    const result = await new PurgeCatalogVersions(repository).execute();

    expect(purgeInputs).toEqual([{ keepPreviousVersions: 3, dryRun: false }]);
    expect(rebuildCount).toBe(1);
    expect(result).toEqual({
      schemaVersion: '1.0',
      status: 'purged',
      dryRun: false,
      keptPreviousVersions: 3,
      scannedDocuments: 2,
      candidateVersions: 3,
      candidateSections: 7,
      purgedVersions: 3,
      purgedSections: 7,
      index: { indexedSections: 4 },
    });
  });

  it('plans candidates without rebuilding the index in dry-run mode', async () => {
    const purgeInputs: CatalogVersionPurgeInput[] = [];
    let rebuildCount = 0;
    const repository: CatalogVersionPurgeRepository = {
      purgeOldDocumentVersions: async (input) => {
        purgeInputs.push(input);
        return {
          dryRun: input.dryRun,
          keptPreviousVersions: input.keepPreviousVersions,
          scannedDocuments: 1,
          candidateVersions: 2,
          candidateSections: 5,
          purgedVersions: 0,
          purgedSections: 0,
        };
      },
      rebuildSearchIndex: async () => {
        rebuildCount += 1;
        return { indexedSections: 0 };
      },
    };

    const result = await new PurgeCatalogVersions(repository).execute({
      sourceKey: 'nodejs-docs',
      keepPreviousVersions: 0,
      dryRun: true,
    });

    expect(purgeInputs).toEqual([
      {
        keepPreviousVersions: 0,
        dryRun: true,
        sourceKey: 'nodejs-docs',
      },
    ]);
    expect(rebuildCount).toBe(0);
    expect(result).toMatchObject({
      schemaVersion: '1.0',
      status: 'planned',
      dryRun: true,
      keptPreviousVersions: 0,
      candidateVersions: 2,
      candidateSections: 5,
      purgedVersions: 0,
      purgedSections: 0,
    });
  });

  it('rejects invalid retention values', async () => {
    const repository: CatalogVersionPurgeRepository = {
      purgeOldDocumentVersions: async () => ({
        dryRun: false,
        keptPreviousVersions: 0,
        scannedDocuments: 0,
        candidateVersions: 0,
        candidateSections: 0,
        purgedVersions: 0,
        purgedSections: 0,
      }),
      rebuildSearchIndex: async () => ({ indexedSections: 0 }),
    };

    await expect(
      new PurgeCatalogVersions(repository).execute({ keepPreviousVersions: -1 }),
    ).rejects.toThrow('Invalid keepPreviousVersions -1');
  });
});
