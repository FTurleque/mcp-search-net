import type { CatalogIntegrityIssueCode, CatalogRepository } from '../ports/catalog-repository.js';

export type CatalogVerificationStatus = 'OK' | 'FAILED';
export type CatalogVerificationSeverity = 'ERROR';
export type CatalogVerificationIssueCode = CatalogIntegrityIssueCode;

export interface CatalogVerificationIssue {
  readonly severity: CatalogVerificationSeverity;
  readonly code: CatalogVerificationIssueCode;
  readonly message: string;
  readonly sourceKey?: string;
  readonly documentPublicId?: string;
  readonly sectionId?: number;
}

export interface CatalogVerificationOutput {
  readonly schemaVersion: '1.0';
  readonly status: CatalogVerificationStatus;
  readonly sqliteIntegrityCheck: string;
  readonly counts: {
    readonly sources: number;
    readonly enabledSources: number;
    readonly documents: number;
    readonly activeDocuments: number;
    readonly currentSections: number;
    readonly indexedSections: number;
    readonly issues: number;
  };
  readonly issues: readonly CatalogVerificationIssue[];
}

export class VerifyCatalog {
  public constructor(private readonly repository: Pick<CatalogRepository, 'verifyIntegrity'>) {}

  public async execute(): Promise<CatalogVerificationOutput> {
    const report = await this.repository.verifyIntegrity();
    return {
      schemaVersion: '1.0',
      status: report.issues.length === 0 ? 'OK' : 'FAILED',
      sqliteIntegrityCheck: report.sqliteIntegrityCheck,
      counts: {
        ...report.counts,
        issues: report.issues.length,
      },
      issues: report.issues.map((issue) => ({ severity: 'ERROR', ...issue })),
    };
  }
}
