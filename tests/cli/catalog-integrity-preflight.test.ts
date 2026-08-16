import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T18:00:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog CLI integrity preflight', () => {
  it('fails closed before search on a catalog with an incoherent FTS index', async () => {
    const fixture = await corruptCatalog();

    const result = await runCatalog(['search', '--path', fixture.path, '--query', 'searchable']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Catalog integrity verification failed');
  });

  it('fails closed before sync configuration loading or network work', async () => {
    const fixture = await corruptCatalog();
    const sourcesPath = join(fixture.root, 'catalog-sources.yml');
    writeFileSync(
      sourcesPath,
      `schema_version: 1\nsources:\n  docs:\n    display_name: Docs\n    base_url: https://docs.example/\n    documents:\n      - stable_key: guide\n        title: Guide\n        url: https://docs.example/guide\n`,
      'utf8',
    );

    const result = await runCatalog([
      'sync',
      '--path',
      fixture.path,
      '--file',
      sourcesPath,
      '--config',
      join(fixture.root, 'missing-application.yml'),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Catalog integrity verification failed');
    expect(result.stderr).not.toContain('missing-application.yml');
  });

  it('keeps rebuild-index available as an explicit repair path and restores gated search', async () => {
    const fixture = await corruptCatalog();

    const rebuild = await runCatalog(['rebuild-index', '--path', fixture.path]);
    expect(rebuild.exitCode).toBe(0);

    const search = await runCatalog(['search', '--path', fixture.path, '--query', 'searchable']);
    expect(search.exitCode).toBe(0);
    expect(search.stdout).toContain('searchable guide content');
  });

  it('fails closed before purge-versions mutates an incoherent catalog', async () => {
    const fixture = await corruptCatalog();

    const result = await runCatalog(['purge-versions', '--path', fixture.path, '--keep', '1']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Catalog integrity verification failed');
  });
});

async function corruptCatalog(): Promise<{ readonly root: string; readonly path: string }> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-cli-integrity-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const repository = new SqliteCatalogRepository(path, clock);
  const source = await repository.addSource({
    sourceKey: 'docs',
    displayName: 'Docs',
    baseUrl: 'https://docs.example/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  const content = 'searchable guide content';
  await repository.commitDocumentRevision({
    document: {
      publicId: 'docs-guide',
      sourceId: source.id,
      canonicalUrl: 'https://docs.example/guide',
      stableKey: 'guide',
      title: 'Guide',
      mimeType: 'text/plain',
      language: 'en',
      status: 'ACTIVE',
    },
    version: {
      contentHash: 'version-hash',
      extractionMode: 'static',
      contentType: 'text/plain',
      metadataJson: '{}',
    },
    sections: [
      {
        ordinal: 0,
        heading: 'Guide',
        content,
        contentHash: 'section-hash',
        characterCount: Array.from(content).length,
        tokenCount: 3,
      },
    ],
  });
  repository.close();

  const database = new Database(path);
  database.exec('DELETE FROM document_section_fts');
  database.close();
  return { root, path };
}

async function runCatalog(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli/catalog.ts'), ...args],
      {
        cwd: resolve('.'),
        windowsHide: true,
        timeout: 10_000,
        env: process.env,
      },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      readonly code?: unknown;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}
