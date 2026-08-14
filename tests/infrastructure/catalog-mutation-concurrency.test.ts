import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];
const clock = { now: () => new Date(10_000) };

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog mutation concurrency', () => {
  it('serializes sync completion before its read-to-write transition', async () => {
    const fixture = await createFixture();
    const run = await fixture.repository.startCatalogSyncRun({ startedAt: new Date(1_000) });
    const child = holdCompetingWriter(fixture.path, fixture.sourceId, fixture.root, 'complete');

    try {
      await waitForFile(join(fixture.root, 'complete.ready'), child);
      await expect(
        fixture.repository.completeCatalogSyncRun(run.id, {
          completedAt: new Date(10_000),
          status: 'SUCCESS',
          documentsChecked: 0,
          documentsAdded: 0,
          documentsUpdated: 0,
          documentsUnchanged: 0,
          documentsFailed: 0,
        }),
      ).resolves.toMatchObject({ status: 'SUCCESS', completedAt: new Date(10_000) });
      await waitForSuccess(child);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });

  it('serializes document observation before its read-to-write transition', async () => {
    const fixture = await createFixture();
    const document = await fixture.repository.upsertDocument({
      publicId: 'concurrency-document',
      sourceId: fixture.sourceId,
      canonicalUrl: 'https://example.test/docs/concurrency',
      stableKey: 'concurrency',
      title: 'Concurrency',
      mimeType: 'text/html',
      language: 'en',
      status: 'ACTIVE',
    });
    const run = await fixture.repository.startCatalogSyncRun({ startedAt: new Date(1_000) });
    const child = holdCompetingWriter(fixture.path, fixture.sourceId, fixture.root, 'observation');

    try {
      await waitForFile(join(fixture.root, 'observation.ready'), child);
      await expect(
        fixture.repository.recordDocumentObservation(document.id, { syncRunId: run.id }),
      ).resolves.toBeUndefined();
      await waitForSuccess(child);
      await expect(
        fixture.repository.completeCatalogSyncRun(run.id, {
          completedAt: new Date(10_000),
          status: 'SUCCESS',
          documentsChecked: 1,
          documentsAdded: 0,
          documentsUpdated: 0,
          documentsUnchanged: 1,
          documentsFailed: 0,
        }),
      ).resolves.toMatchObject({ status: 'SUCCESS' });
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
});

async function createFixture(): Promise<{
  readonly root: string;
  readonly path: string;
  readonly repository: SqliteCatalogRepository;
  readonly sourceId: number;
}> {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-mutation-concurrency-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const repository = new SqliteCatalogRepository(path, clock);
  repositories.push(repository);
  const source = await repository.addSource({
    sourceKey: 'concurrency-source',
    displayName: 'Concurrency source',
    baseUrl: 'https://example.test/docs/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  return { root, path, repository, sourceId: source.id };
}

function holdCompetingWriter(
  databasePath: string,
  sourceId: number,
  root: string,
  scenario: string,
): ChildProcess {
  const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'hold-catalog-write-lock.ts');
  return spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fixturePath,
      databasePath,
      join(root, `${scenario}.ready`),
      String(sourceId),
      '250',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
}

async function waitForFile(path: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (child.exitCode !== null) {
      throw new Error(`Catalog contention fixture exited before readiness with code ${child.exitCode}`);
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await delay(10);
  }
}

async function waitForSuccess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) {
      throw new Error(`Catalog contention fixture failed with code ${child.exitCode}`);
    }
    return;
  }
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Catalog contention fixture failed with code ${code}: ${stderr}`));
    });
  });
}
