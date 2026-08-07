import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ingestTextDocument } from '../../src/cli/catalog-ingest-text.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('audit catalog ingestion remediation', () => {
  it('rejects an oversized local text file before reading it into memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-ingest-audit-'));
    roots.push(root);
    const repository = new SqliteCatalogRepository(join(root, 'catalog.db'), {
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    repositories.push(repository);
    await repository.addSource({
      sourceKey: 'local',
      displayName: 'Local',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });

    const filePath = join(root, 'oversized.md');
    writeFileSync(filePath, '');
    truncateSync(filePath, 16 * 1024 * 1024 + 1);

    await expect(
      ingestTextDocument(repository, {
        sourceKey: 'local',
        filePath,
        canonicalUrl: 'https://example.test/oversized',
        title: 'Oversized',
        language: 'en',
        mimeType: 'text/markdown',
      }),
    ).rejects.toThrow(/CATALOG_INGEST_FILE_TOO_LARGE/u);
  });

  it('rejects non-HTTP transport URLs before committing a revision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-ingest-url-audit-'));
    roots.push(root);
    const repository = new SqliteCatalogRepository(join(root, 'catalog.db'), {
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    repositories.push(repository);
    await repository.addSource({
      sourceKey: 'local',
      displayName: 'Local',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });

    const filePath = join(root, 'small.md');
    writeFileSync(filePath, 'x');

    await expect(
      ingestTextDocument(repository, {
        sourceKey: 'local',
        filePath,
        canonicalUrl: 'file:///tmp/small.md',
        title: 'Small',
        language: 'en',
        mimeType: 'text/markdown',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
  });
});
