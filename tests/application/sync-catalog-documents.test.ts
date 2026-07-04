import { describe, expect, it } from 'vitest';

import type { ContentFetcher } from '../../src/application/ports/content-fetcher.js';
import { SyncCatalogDocuments } from '../../src/application/use-cases/sync-catalog-documents.js';
import type {
  CatalogDocument,
  CatalogDocumentInput,
  CatalogSource,
  CatalogSyncRun,
  CatalogSyncRunInput,
  DocumentSection,
  DocumentSectionInput,
  DocumentVersion,
  DocumentVersionInput,
} from '../../src/domain/models/catalog.js';
import type { ContentFetchResult } from '../../src/domain/models/content.js';

class CatalogSyncRepositoryStub {
  private nextDocumentId = 1;
  private nextVersionId = 1;
  private nextRunId = 1;
  public readonly versions: DocumentVersionInput[] = [];
  public readonly sections: DocumentSectionInput[][] = [];

  public constructor(private readonly sources: readonly CatalogSource[]) {}

  public async listSources(): Promise<readonly CatalogSource[]> {
    return this.sources;
  }

  public async getDocumentByPublicId(publicId: string): Promise<CatalogDocument | undefined> {
    void publicId;
    return undefined;
  }

  public async upsertDocument(input: CatalogDocumentInput): Promise<CatalogDocument> {
    const document: CatalogDocument = {
      id: this.nextDocumentId,
      ...input,
      currentVersionId: this.nextVersionId,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.nextDocumentId += 1;
    return document;
  }

  public async addDocumentVersion(input: DocumentVersionInput): Promise<DocumentVersion> {
    this.versions.push(input);
    const version: DocumentVersion = {
      id: this.nextVersionId,
      ...input,
      fetchedAt: now,
    };
    this.nextVersionId += 1;
    return version;
  }

  public async replaceDocumentSections(
    documentVersionId: number,
    sections: readonly DocumentSectionInput[],
  ): Promise<readonly DocumentSection[]> {
    this.sections.push([...sections]);
    return sections.map((section, index) => ({
      id: index + 1,
      documentVersionId,
      ...section,
    }));
  }

  public async addCatalogSyncRun(input: CatalogSyncRunInput): Promise<CatalogSyncRun> {
    const syncRun: CatalogSyncRun = {
      id: this.nextRunId,
      ...input,
    };
    this.nextRunId += 1;
    return syncRun;
  }
}

class ContentFetcherStub implements ContentFetcher {
  public calls = 0;

  public async fetch(): Promise<ContentFetchResult> {
    this.calls += 1;
    return {
      requestedUrl: 'https://docs.example/guide.html',
      finalUrl: 'https://docs.example/guide.html',
      canonicalUrl: 'https://docs.example/guide.html',
      title: 'Fetched Guide',
      markdown: '# Fetched Guide\n\nContent body.',
      documentSections: [{ heading: 'Fetched Guide', markdown: '# Fetched Guide\n\nContent body.' }],
      contentType: 'text/html',
      fetchedAt: now.toISOString(),
      extractionMode: 'static',
      statusCode: 200,
      contentHash: 'content-hash',
      metadata: {},
      links: [],
    };
  }
}

describe('SyncCatalogDocuments', () => {
  it('fetches one declared document, stores it and records a successful run', async () => {
    const repository = new CatalogSyncRepositoryStub([enabledSource]);
    const fetcher = new ContentFetcherStub();

    const result = await new SyncCatalogDocuments(repository, fetcher, fixedClock).execute({
      sourceKey: 'enabled-docs',
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          title: 'Guide',
          url: 'https://docs.example/guide.html',
          language: 'en-US',
          mimeType: 'text/html',
          enabled: true,
        },
      ],
      limit: 1,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      maxRedirects: 3,
    });

    expect(fetcher.calls).toBe(1);
    expect(result).toMatchObject({
      schemaVersion: '1.0',
      dryRun: false,
      checkedCount: 1,
      addedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      syncRun: {
        id: 1,
        sourceId: enabledSource.id,
        status: 'SUCCESS',
        documentsChecked: 1,
        documentsAdded: 1,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsFailed: 0,
      },
      documents: [
        {
          sourceKey: 'enabled-docs',
          stableKey: 'guide',
          title: 'Fetched Guide',
          url: 'https://docs.example/guide.html',
          status: 'added',
          sectionCount: 1,
        },
      ],
    });
    expect(repository.versions[0]).toMatchObject({
      contentHash: 'content-hash',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
    });
    expect(repository.sections[0]?.[0]).toMatchObject({
      heading: 'Fetched Guide',
      content: '# Fetched Guide\n\nContent body.',
    });
  });
});

const now = new Date(1_000);
const fixedClock = { now: () => now };

const enabledSource: CatalogSource = {
  id: 1,
  sourceKey: 'enabled-docs',
  displayName: 'Enabled Documentation',
  baseUrl: 'https://docs.example/',
  sourceType: 'documentation',
  language: 'en-US',
  freshnessPolicy: 'weekly',
  syncStrategy: 'manual',
  enabled: true,
  createdAt: now,
  updatedAt: now,
};
