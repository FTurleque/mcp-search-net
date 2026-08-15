/* eslint-disable @typescript-eslint/no-deprecated -- concurrency regression deliberately uses the legacy low-level version path */
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteCatalogRepository,
} from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import {
  SqliteCatalogVersionPurger,
} from '../../src/infrastructure/catalog/sqlite-catalog-version-purger.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];
const purgers: SqliteCatalogVersionPurger[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
    await waitForExit(child).catch(() => undefined);
  }
  purgers.splice(0).forEach((purger) => purger.close());
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog version purge concurrency', () => {
  it('selects purge candidates only after a competing promotion commits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-purge-concurrency-'));
    roots.push(root);
    const path = join(root, 'catalog.db');
    let now = 1_000;
    const clock = { now: () => new Date(now) };
    const catalog = new SqliteCatalogRepository(path, clock);
    catalogs.push(catalog);

    const source = await catalog.addSource({
      sourceKey: 'concurrent-docs',
      displayName: 'Concurrent docs',
      baseUrl: 'https://example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await catalog.upsertDocument({
      publicId: 'concurrent-guide',
      sourceId: source.id,
      canonicalUrl: 'https://example.test/guide',
      stableKey: 'guide',
      title: 'Concurrent guide',
      mimeType: 'text/html',
      language: 'en',
      status: 'ACTIVE',
    });

    const version1 = await addVersionWithSection(catalog, document.id, 'hash-v1', 'section-v1');
    now = 2_000;
    await addVersionWithSection(catalog, document.id, 'hash-v2', 'section-v2');
    now = 3_000;
    await addVersionWithSection(catalog, document.id, 'hash-v3', 'section-v3');

    const purger = new SqliteCatalogVersionPurger(path, clock);
    purgers.push(purger);
    const child = fork(
      resolve('tests/fixtures/hold-catalog-version-promotion.ts'),
      [path, String(document.id), String(version1.id), '300'],
      { execArgv: ['--import', 'tsx'], silent: true },
    );
    children.push(child);
    await waitForReady(child);

    await expect(
      purger.purgeOldDocumentVersions({ keepPreviousVersions: 0, dryRun: false }),
    ).resolves.toEqual({
      dryRun: false,
      keptPreviousVersions: 0,
      scannedDocuments: 1,
      candidateVersions: 2,
      candidateSections: 2,
      purgedVersions: 2,
      purgedSections: 2,
    });
    await waitForExit(child);
    expect(child.exitCode).toBe(0);

    expect(readHashes(path)).toEqual(['hash-v1']);
    await expect(catalog.getDocumentByPublicId('concurrent-guide')).resolves.toMatchObject({
      currentVersionId: version1.id,
    });
  });
});

async function addVersionWithSection(
  catalog: SqliteCatalogRepository,
  documentId: number,
  versionHash: string,
  sectionHash: string,
) {
  const version = await catalog.addDocumentVersion({
    documentId,
    contentHash: versionHash,
    isCurrent: true,
    extractionMode: 'static',
    contentType: 'text/html',
    metadataJson: '{}',
  });
  await catalog.replaceDocumentSections(version.id, [
    {
      ordinal: 1,
      content: `Content for ${sectionHash}`,
      contentHash: sectionHash,
      characterCount: 22,
    },
  ]);
  return version;
}

function readHashes(path: string): readonly string[] {
  const database = new Database(path, { readonly: true });
  try {
    return database
      .prepare<[], { content_hash: string }>(
        'SELECT content_hash FROM document_versions ORDER BY id',
      )
      .all()
      .map((row) => row.content_hash);
  } finally {
    database.close();
  }
}

async function waitForReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error('Timed out waiting for promotion fixture')),
      5_000,
    );
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.on('message', (message: unknown) => {
      if (
        message !== null &&
        typeof message === 'object' &&
        (message as { readonly type?: unknown }).type === 'ready'
      ) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit, rejectExit) => {
    const timeout = setTimeout(
      () => rejectExit(new Error('Timed out waiting for promotion fixture exit')),
      5_000,
    );
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
  });
}
