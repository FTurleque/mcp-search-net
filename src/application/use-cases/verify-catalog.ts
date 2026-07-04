import type { CatalogRepository } from '../ports/catalog-repository.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogSource,
} from '../../domain/models/catalog.js';

export type CatalogVerificationStatus = 'OK' | 'FAILED';
export type CatalogVerificationSeverity = 'ERROR';
export type CatalogVerificationIssueCode =
  | 'DOCUMENT_SOURCE_MISSING'
  | 'ACTIVE_DOCUMENT_WITHOUT_CURRENT_VERSION'
  | 'CURRENT_SECTION_DOCUMENT_NOT_LISTED'
  | 'CURRENT_SECTION_SOURCE_NOT_LISTED'
  | 'CURRENT_SECTION_VERSION_MISMATCH';

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
  readonly counts: {
    readonly sources: number;
    readonly enabledSources: number;
    readonly documents: number;
    readonly activeDocuments: number;
    readonly currentSections: number;
    readonly issues: number;
  };
  readonly issues: readonly CatalogVerificationIssue[];
}

export class VerifyCatalog {
  public constructor(
    private readonly repository: Pick<
      CatalogRepository,
      'listSources' | 'listDocuments' | 'listCurrentDocumentSections'
    >,
  ) {}

  public async execute(): Promise<CatalogVerificationOutput> {
    const [sources, documents, currentSections] = await Promise.all([
      this.repository.listSources(),
      this.repository.listDocuments(),
      this.repository.listCurrentDocumentSections(),
    ]);
    const issues = collectIssues(sources, documents, currentSections);

    return {
      schemaVersion: '1.0',
      status: issues.length === 0 ? 'OK' : 'FAILED',
      counts: {
        sources: sources.length,
        enabledSources: sources.filter((source) => source.enabled).length,
        documents: documents.length,
        activeDocuments: documents.filter((document) => document.status === 'ACTIVE').length,
        currentSections: currentSections.length,
        issues: issues.length,
      },
      issues,
    };
  }
}

function collectIssues(
  sources: readonly CatalogSource[],
  documents: readonly CatalogDocument[],
  currentSections: readonly CatalogCurrentDocumentSection[],
): readonly CatalogVerificationIssue[] {
  const issues: CatalogVerificationIssue[] = [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  for (const document of documents) {
    const source = sourcesById.get(document.sourceId);
    if (source === undefined) {
      issues.push({
        severity: 'ERROR',
        code: 'DOCUMENT_SOURCE_MISSING',
        message: `Document ${document.publicId} references missing source ${document.sourceId}`,
        documentPublicId: document.publicId,
      });
    }

    if (document.status === 'ACTIVE' && document.currentVersionId === undefined) {
      issues.push({
        severity: 'ERROR',
        code: 'ACTIVE_DOCUMENT_WITHOUT_CURRENT_VERSION',
        message: `Active document ${document.publicId} has no current version`,
        documentPublicId: document.publicId,
        ...(source === undefined ? {} : { sourceKey: source.sourceKey }),
      });
    }
  }

  for (const entry of currentSections) {
    const document = documentsById.get(entry.document.id);
    const source = sourcesById.get(entry.source.id);

    if (document === undefined) {
      issues.push({
        severity: 'ERROR',
        code: 'CURRENT_SECTION_DOCUMENT_NOT_LISTED',
        message: `Section ${entry.section.id} references an unknown document`,
        sourceKey: entry.source.sourceKey,
        documentPublicId: entry.document.publicId,
        sectionId: entry.section.id,
      });
      continue;
    }

    if (source === undefined) {
      issues.push({
        severity: 'ERROR',
        code: 'CURRENT_SECTION_SOURCE_NOT_LISTED',
        message: `Section ${entry.section.id} references an unknown source`,
        sourceKey: entry.source.sourceKey,
        documentPublicId: entry.document.publicId,
        sectionId: entry.section.id,
      });
    }

    if (document.currentVersionId !== entry.section.documentVersionId) {
      issues.push({
        severity: 'ERROR',
        code: 'CURRENT_SECTION_VERSION_MISMATCH',
        message: `Section ${entry.section.id} is not attached to the document current version`,
        sourceKey: entry.source.sourceKey,
        documentPublicId: entry.document.publicId,
        sectionId: entry.section.id,
      });
    }
  }

  return issues;
}
