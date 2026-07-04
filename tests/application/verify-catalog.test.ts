import { describe, expect, it } from 'vitest';

import { VerifyCatalog } from '../../src/application/use-cases/verify-catalog.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogSource,
} from '../../src/domain/models/catalog.js';

class VerifyOnlyCatalogRepository {
  public constructor(
    private readonly sources: readonly CatalogSource[],
    private readonly documents: readonly CatalogDocument[],
    private readonly currentSections: readonly CatalogCurrentDocumentSection[],
  ) {}

  public async listSources(): Promise<readonly CatalogSource[]> {
    return this.sources;
  }

  public async listDocuments(): Promise<readonly CatalogDocument[]> {
    return this.documents;
  }

  public async listCurrentDocumentSections(): Promise<readonly CatalogCurrentDocumentSection[]> {
    return this.currentSections;
  }
}

describe('VerifyCatalog', () => {
  it('returns OK when catalog references are coherent', async () => {
    const repository = new VerifyOnlyCatalogRepository(
      [source],
      [activeDocument],
      [currentSection],
    );

    const result = await new VerifyCatalog(repository).execute();

    expect(result).toEqual({
      schemaVersion: '1.0',
      status: 'OK',
      counts: {
        sources: 1,
        enabledSources: 1,
        documents: 1,
        activeDocuments: 1,
        currentSections: 1,
        issues: 0,
      },
      issues: [],
    });
  });

  it('reports missing sources, missing current versions, and mismatched current sections', async () => {
    const documentWithoutSource: CatalogDocument = {
      ...activeDocument,
      id: 20,
      publicId: 'orphan-doc',
      sourceId: 999,
      currentVersionId: undefined,
    };
    const mismatchedSection: CatalogCurrentDocumentSection = {
      ...currentSection,
      section: {
        ...currentSection.section,
        id: 2000,
        documentVersionId: 999,
      },
    };
    const repository = new VerifyOnlyCatalogRepository(
      [source],
      [documentWithoutSource, activeDocument],
      [mismatchedSection],
    );

    const result = await new VerifyCatalog(repository).execute();

    expect(result.status).toBe('FAILED');
    expect(result.counts).toEqual({
      sources: 1,
      enabledSources: 1,
      documents: 2,
      activeDocuments: 2,
      currentSections: 1,
      issues: 3,
    });
    expect(result.issues).toEqual([
      {
        severity: 'ERROR',
        code: 'DOCUMENT_SOURCE_MISSING',
        message: 'Document orphan-doc references missing source 999',
        documentPublicId: 'orphan-doc',
      },
      {
        severity: 'ERROR',
        code: 'ACTIVE_DOCUMENT_WITHOUT_CURRENT_VERSION',
        message: 'Active document orphan-doc has no current version',
        documentPublicId: 'orphan-doc',
      },
      {
        severity: 'ERROR',
        code: 'CURRENT_SECTION_VERSION_MISMATCH',
        message: 'Section 2000 is not attached to the document current version',
        sourceKey: 'nodejs-docs',
        documentPublicId: 'nodejs-fs',
        sectionId: 2000,
      },
    ]);
  });
});

const now = new Date(1_000);

const source: CatalogSource = {
  id: 1,
  sourceKey: 'nodejs-docs',
  displayName: 'Node.js Documentation',
  baseUrl: 'https://nodejs.org/api/',
  sourceType: 'api',
  language: 'en-US',
  freshnessPolicy: 'weekly',
  syncStrategy: 'manual',
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const activeDocument: CatalogDocument = {
  id: 10,
  publicId: 'nodejs-fs',
  sourceId: source.id,
  canonicalUrl: 'https://nodejs.org/api/fs.html',
  stableKey: 'fs',
  title: 'File system',
  mimeType: 'text/html',
  language: 'en-US',
  status: 'ACTIVE',
  currentVersionId: 100,
  firstSeenAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

const currentSection: CatalogCurrentDocumentSection = {
  source,
  document: activeDocument,
  section: {
    id: 1000,
    documentVersionId: 100,
    ordinal: 1,
    heading: 'fs.createReadStream',
    headingPath: 'File system > fs.createReadStream',
    headingLevel: 2,
    anchor: 'fscreatereadstream',
    content: 'Creates a readable stream from a file path.',
    contentHash: 'section-hash',
    characterCount: 42,
    tokenCount: 8,
  },
};
