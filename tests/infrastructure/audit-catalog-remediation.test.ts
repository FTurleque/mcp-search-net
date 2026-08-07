import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('audit catalog remediation', () => {
  it('chunks oversized current sections before SQLite and FTS persistence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-audit-'));
    roots.push(root);
    const repository = new SqliteCatalogRepository(join(root, 'catalog.db'), {
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    repositories.push(repository);

    const source = await repository.addSource({
      sourceKey: 'audit-docs',
      displayName: 'Audit docs',
      baseUrl: 'https://example.test/docs/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const content = Array.from({ length: 4_000 }, (_, index) => `token-${index}`).join(' ');

    const revision = await repository.commitDocumentRevision({
      document: {
        publicId: 'doc_audit_chunking',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/docs/large',
        stableKey: 'large',
        title: 'Large document',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: createHash('sha256').update(content).digest('hex'),
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          heading: 'Large',
          headingPath: 'Large',
          headingLevel: 1,
          anchor: 'large',
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          characterCount: Array.from(content).length,
          tokenCount: 4_000,
        },
      ],
    });

    expect(revision.sections.length).toBeGreaterThan(1);
    expect(Math.max(...revision.sections.map((section) => section.characterCount))).toBeLessThanOrEqual(
      12_000,
    );
    expect(new Set(revision.sections.map((section) => section.ordinal)).size).toBe(
      revision.sections.length,
    );
    expect(new Set(revision.sections.map((section) => section.contentHash)).size).toBe(
      revision.sections.length,
    );

    const search = await repository.searchDocuments({ query: 'token-3999', limit: 10 });
    expect(search.some((result) => result.document.publicId === 'doc_audit_chunking')).toBe(true);

    const integrity = await repository.verifyIntegrity();
    expect(integrity.issues).toEqual([]);
    expect(integrity.counts.currentSections).toBe(revision.sections.length);
    expect(integrity.counts.indexedSections).toBe(revision.sections.length);
  });
});
