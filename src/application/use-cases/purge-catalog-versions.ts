import type { CatalogSearchIndexRebuildResult } from '../../domain/models/catalog.js';

const DEFAULT_KEEP_PREVIOUS_VERSIONS = 3;

export interface CatalogVersionPurgeInput {
  readonly keepPreviousVersions: number;
  readonly dryRun: boolean;
  readonly sourceKey?: string;
}

export interface CatalogVersionPurgeResult {
  readonly dryRun: boolean;
  readonly keptPreviousVersions: number;
  readonly scannedDocuments: number;
  readonly candidateVersions: number;
  readonly candidateSections: number;
  readonly purgedVersions: number;
  readonly purgedSections: number;
}

export interface CatalogVersionPurgeRepository {
  purgeOldDocumentVersions(input: CatalogVersionPurgeInput): Promise<CatalogVersionPurgeResult>;
  rebuildSearchIndex(): Promise<CatalogSearchIndexRebuildResult>;
}

export interface PurgeCatalogVersionsInput {
  readonly keepPreviousVersions?: number;
  readonly dryRun?: boolean;
  readonly sourceKey?: string;
}

export interface PurgeCatalogVersionsOutput extends CatalogVersionPurgeResult {
  readonly schemaVersion: '1.0';
  readonly status: 'planned' | 'purged';
  readonly index?: CatalogSearchIndexRebuildResult;
}

export class PurgeCatalogVersions {
  public constructor(private readonly repository: CatalogVersionPurgeRepository) {}

  public async execute(input: PurgeCatalogVersionsInput = {}): Promise<PurgeCatalogVersionsOutput> {
    const keepPreviousVersions = normalizeKeepPreviousVersions(input.keepPreviousVersions);
    const dryRun = input.dryRun ?? false;
    const result = await this.repository.purgeOldDocumentVersions({
      keepPreviousVersions,
      dryRun,
      ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
    });

    if (result.dryRun || result.purgedVersions === 0) {
      return {
        schemaVersion: '1.0',
        status: result.dryRun ? 'planned' : 'purged',
        ...result,
      };
    }

    const index = await this.repository.rebuildSearchIndex();
    return {
      schemaVersion: '1.0',
      status: 'purged',
      ...result,
      index,
    };
  }
}

export function normalizeKeepPreviousVersions(value: number | undefined): number {
  if (value === undefined) return DEFAULT_KEEP_PREVIOUS_VERSIONS;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid keepPreviousVersions ${value}`);
  }
  return value;
}
