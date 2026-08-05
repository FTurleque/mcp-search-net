import { describe, expect, it } from 'vitest';

import type { CatalogIntegrityReport } from '../../src/application/ports/catalog-repository.js';
import { VerifyCatalog } from '../../src/application/use-cases/verify-catalog.js';

class VerifyOnlyCatalogRepository {
  public constructor(private readonly report: CatalogIntegrityReport) {}

  public async verifyIntegrity(): Promise<CatalogIntegrityReport> {
    return this.report;
  }
}

describe('VerifyCatalog', () => {
  it('returns an exploitable OK report for a coherent catalog', async () => {
    const result = await new VerifyCatalog(
      new VerifyOnlyCatalogRepository(healthyReport),
    ).execute();

    expect(result).toEqual({
      schemaVersion: '1.0',
      status: 'OK',
      sqliteIntegrityCheck: 'ok',
      counts: {
        sources: 1,
        enabledSources: 1,
        documents: 1,
        activeDocuments: 1,
        currentSections: 1,
        indexedSections: 1,
        issues: 0,
      },
      issues: [],
    });
  });

  it('maps repository integrity findings to stable public issue codes', async () => {
    const repository = new VerifyOnlyCatalogRepository({
      ...healthyReport,
      counts: { ...healthyReport.counts, indexedSections: 0 },
      issues: [
        {
          code: 'CURRENT_SECTION_MISSING_FROM_FTS',
          message: 'Current section 42 is missing from FTS',
          sourceKey: 'sample',
          documentPublicId: 'guide',
          sectionId: 42,
        },
      ],
    });

    const result = await new VerifyCatalog(repository).execute();

    expect(result.status).toBe('FAILED');
    expect(result.counts).toMatchObject({ currentSections: 1, indexedSections: 0, issues: 1 });
    expect(result.issues).toEqual([
      {
        severity: 'ERROR',
        code: 'CURRENT_SECTION_MISSING_FROM_FTS',
        message: 'Current section 42 is missing from FTS',
        sourceKey: 'sample',
        documentPublicId: 'guide',
        sectionId: 42,
      },
    ]);
  });
});

const healthyReport: CatalogIntegrityReport = {
  sqliteIntegrityCheck: 'ok',
  counts: {
    sources: 1,
    enabledSources: 1,
    documents: 1,
    activeDocuments: 1,
    currentSections: 1,
    indexedSections: 1,
  },
  issues: [],
};
