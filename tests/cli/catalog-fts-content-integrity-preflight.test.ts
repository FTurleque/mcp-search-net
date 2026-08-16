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
const clock = { now: () => new Date('2026-08-16T20:30:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog CLI FTS content integrity preflight', () => {
  it('keeps diagnostics and rebuild available while business commands fail closed', async () => {
    const fixture = await corruptCatalogContent();

    const verify = await runCatalog(['verify', '--path', fixture.path]);
    expect(verify.exitCode).toBe(1);
    expect(verify.stderr).toBe('');
    expect(verify.stdout).toContain('FTS_ENTRY_CONTENT_MISMATCH');
    expect(verify.stdout).toContain('"status": "FAILED"');

    const searchBeforeRepair = await runCatalog([
      'search',
      '--path',
      fixture.path,
      '--query',
      'authoritative',
    ]);
    expect(searchBeforeRepair.exitCode).toBe(1);
    expect(searchBeforeRepair.stdout).toBe('');
    expect(searchBeforeRepair.stderr).toContain('Catalog integrity verification failed');

    const sourcesPath = join(fixture.root, 'catalog-sources.yml');
    writeFileSync(
      sourcesPath,
      `schema_version: 1\nsources:\n  docs:\n    display_name: Documentation\n    base_url: https://docs.example/\n    documents:\n      - stable_key: guide\n        title: Guide\n        url: https://docs.example/guide\n`,
      'utf8',
    );
    const sync = await runCatalog([
      'sync',
      '--path',
      fixture.path,
      '--file',
      sourcesPath,
      '--config',
      join(fixture.root, 'missing-application.yml'),
    ]);
    expect(sync.exitCode).toBe(1);
    expect(sync.stderr).toContain('Catalog integrity verification failed');
    expect(sync.stderr).not.toContain('missing-application.yml');

    const purge = await runCatalog(['purge-versions', '--path', fixture.path, '--keep', '1']);
    expect(purge.exitCode).toBe(1);
    expect(purge.stderr).toContain('Catalog integrity verification failed');

    const rebuild = await runCatalog(['rebuild-index', '--path', fixture.path]);
    expect(rebuild.exitCode).toBe(0);
    expect(rebuild.stderr).toBe('');
    expect(rebuild.stdout).toContain('"indexedSections": 1');

    const verifyAfterRepair = await runCatalog(['verify', '--path', fixture.path]);
    expect(verifyAfterRepair.exitCode).toBe(0);
    expect(verifyAfterRepair.stdout).toContain('"status": "OK"');

    const searchAfterRepair = await runCatalog([
      'search',
      '--path',
      fixture.path,
      '--query',
      'authoritative',
    ]);
    expect(searchAfterRepair.exitCode).toBe(0);
    expect(searchAfterRepair.stdout).toContain('authoritative searchable content');
  });
});

async function corruptCatalogContent(): Promise<{
  readonly root: string;
  readonly path: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-cli-fts-content-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const repository = new SqliteCatalogRepository(path, clock);
  const source = await repository.addSource({
    sourceKey: 'docs',
    displayName: 'Documentation',
    baseUrl: 'https://docs.example/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  const content = 'authoritative searchable content';
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
  try {
    const before = database
      .prepare<[], { readonly rowid: number }>('SELECT rowid FROM document_section_fts LIMIT 1')
      .get();
    if (before === undefined) throw new Error('Expected populated FTS fixture');
    database.prepare<[string, number]>(
      'UPDATE document_section_fts SET content = ? WHERE rowid = ?',
    ).run('obsolete indexed content', before.rowid);
    const after = database
      .prepare<[number], { readonly rowid: number }>(
        'SELECT rowid FROM document_section_fts WHERE rowid = ?',
      )
      .get(before.rowid);
    expect(after?.rowid).toBe(before.rowid);
  } finally {
    database.close();
  }
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