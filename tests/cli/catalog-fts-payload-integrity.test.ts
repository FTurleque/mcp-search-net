import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

interface SectionIdentityRow {
  readonly section_id: number;
  readonly document_id: number;
}

type FtsReplacementParams = [
  number,
  number,
  number,
  string,
  string,
  string,
  string,
  string,
  string,
];

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T18:00:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog CLI FTS payload integrity', () => {
  it('blocks stale FTS results until rebuild-index repairs the payload', async () => {
    const path = await createCorruptCatalog();

    const blocked = await runCatalog(['search', '--path', path, '--query', 'obsolete']);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stdout).toBe('');
    expect(blocked.stderr).toContain('Catalog integrity verification failed');

    const rebuild = await runCatalog(['rebuild-index', '--path', path]);
    expect(rebuild.exitCode).toBe(0);

    const staleSearch = await runCatalog(['search', '--path', path, '--query', 'obsolete']);
    expect(staleSearch.exitCode).toBe(0);
    expect(staleSearch.stdout).toContain('"results": []');

    const repairedSearch = await runCatalog(['search', '--path', path, '--query', 'authoritative']);
    expect(repairedSearch.exitCode).toBe(0);
    expect(repairedSearch.stdout).toContain('authoritative searchable guide content');
  });
});

async function createCorruptCatalog(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-cli-fts-payload-'));
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
  await repository.commitDocumentRevision({
    document: {
      publicId: 'guide',
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
        content: 'authoritative searchable guide content',
        contentHash: 'section-hash',
        characterCount: 38,
        tokenCount: 4,
      },
    ],
  });
  repository.close();

  const database = new Database(path);
  try {
    const row = database
      .prepare<[], SectionIdentityRow>(
        `
        SELECT document_sections.id AS section_id, documents.id AS document_id
        FROM document_sections
        INNER JOIN document_versions
          ON document_versions.id = document_sections.document_version_id
        INNER JOIN documents ON documents.id = document_versions.document_id
        WHERE documents.public_id = 'guide'
        LIMIT 1
      `,
      )
      .get();
    if (row === undefined) throw new Error('TEST_SECTION_NOT_FOUND');

    const remove = database.prepare<[number]>('DELETE FROM document_section_fts WHERE rowid = ?');
    remove.run(row.section_id);

    const insert = database.prepare<FtsReplacementParams>(`
      INSERT INTO document_section_fts(
        rowid, section_id, document_id, source_key, language,
        title, heading, heading_path, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      row.section_id,
      row.section_id,
      row.document_id,
      'docs',
      'en',
      'Guide',
      'Guide',
      '',
      'obsolete indexed payload',
    );
  } finally {
    database.close();
  }
  return path;
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
