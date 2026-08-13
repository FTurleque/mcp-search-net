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
    expect(
      Math.max(...revision.sections.map((section) => section.characterCount)),
    ).toBeLessThanOrEqual(12_000);
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

  it('preserves identical chunks at distinct logical positions with stable overlap and ordinals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-repeated-chunks-'));
    roots.push(root);
    const path = join(root, 'catalog.db');
    const clock = { now: () => new Date('2026-08-11T00:00:00.000Z') };
    const repository = new SqliteCatalogRepository(path, clock);
    repositories.push(repository);
    const source = await repository.addSource({
      sourceKey: 'repeated-docs',
      displayName: 'Repeated docs',
      baseUrl: 'https://example.test/repeated/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const repeatedChunk = 'A'.repeat(12_000);
    const firstLong = `${repeatedChunk} alpha-tail`;
    const secondLong = `${repeatedChunk} beta-tail`;
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');

    const revision = await repository.commitDocumentRevision({
      document: {
        publicId: 'doc_repeated_chunks',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/repeated/guide',
        stableKey: 'guide',
        title: 'Repeated chunks guide',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: hash(`${firstLong}${repeatedChunk}${secondLong}`),
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        sectionInput(0, 'Alpha', 'alpha', firstLong, hash(firstLong)),
        sectionInput(1, 'Repeated', 'repeated', repeatedChunk, hash(repeatedChunk)),
        sectionInput(2, 'Beta', 'beta', secondLong, hash(secondLong)),
      ],
    });

    expect(revision.sections.map((section) => section.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(revision.sections.map((section) => section.anchor)).toEqual([
      'alpha',
      'alpha-part-2',
      'repeated',
      'beta',
      'beta-part-2',
    ]);
    expect(revision.sections[0]?.contentHash).toBe(revision.sections[2]?.contentHash);
    expect(revision.sections[0]?.contentHash).toBe(revision.sections[3]?.contentHash);
    expect(revision.sections[1]?.content.startsWith('A'.repeat(400))).toBe(true);
    expect(revision.sections[4]?.content.startsWith('A'.repeat(400))).toBe(true);
    await expect(repository.searchDocuments({ query: 'alpha tail' })).resolves.toHaveLength(1);
    await expect(repository.searchDocuments({ query: 'beta tail' })).resolves.toHaveLength(1);
    await expect(repository.verifyIntegrity()).resolves.toMatchObject({ issues: [] });

    repository.close();
    repositories.splice(repositories.indexOf(repository), 1);
    const reopened = new SqliteCatalogRepository(path, clock);
    repositories.push(reopened);
    await expect(reopened.verifyIntegrity()).resolves.toMatchObject({
      counts: { currentSections: 5, indexedSections: 5 },
      issues: [],
    });
  });
});

function sectionInput(
  ordinal: number,
  heading: string,
  anchor: string,
  content: string,
  contentHash: string,
) {
  return {
    ordinal,
    heading,
    headingPath: heading,
    headingLevel: 1,
    anchor,
    content,
    contentHash,
    characterCount: Array.from(content).length,
    tokenCount: content.trim().split(/\s+/u).length,
  };
}
