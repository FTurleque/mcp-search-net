/* eslint-disable @typescript-eslint/no-deprecated -- regressions intentionally exercise the retained two-step catalog API */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  SearchHistoryRecordInput,
} from '../../src/application/ports/search-history-repository.js';
import {
  SqliteCatalogRepository,
} from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import {
  SqliteCatalogVersionPurger,
} from '../../src/infrastructure/catalog/sqlite-catalog-version-purger.js';
import {
  SqliteSearchHistoryRepository,
} from '../../src/infrastructure/history/sqlite-search-history-repository.js';
import { FileLeaseLock } from '../../src/infrastructure/locking/file-lease-lock.js';

interface SyncRunStateRow {
  readonly status: string;
  readonly completed_at: number | null;
  readonly owner_token: string | null;
}

interface VersionStateRow {
  readonly is_current: number;
  readonly pending_current: number;
}

const roots: string[] = [];
const closeables: { close(): void }[] = [];

const clock = { now: () => new Date(2_000) };

afterEach(() => {
  closeables.splice(0).reverse().forEach((closeable) => closeable.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('residual audit persistence regressions', () => {
  it(
    'retains sync-run ownership after a failed completion so the same owner can retry',
    async () => {
      const path = createPath('sync-retry', 'catalog.db');
      const repository = new SqliteCatalogRepository(path, clock, {
        syncRunLease: {
          pid: 4242,
          hostname: 'test-host',
          ownerTokenFactory: () => 'retryable-owner-token',
          processAlive: () => true,
          processIdentity: () => 'same-process-lifetime',
        },
      });
      closeables.push(repository);
      const run = await repository.startCatalogSyncRun({ startedAt: new Date(1_000) });

      await expect(
        repository.completeCatalogSyncRun(run.id, {
          completedAt: new Date(2_000),
          status: 'BROKEN' as 'SUCCESS',
          documentsChecked: 0,
          documentsAdded: 0,
          documentsUpdated: 0,
          documentsUnchanged: 0,
          documentsFailed: 0,
        }),
      ).rejects.toThrow();

      expect(readSyncRun(path, run.id)).toMatchObject({
        status: 'RUNNING',
        completed_at: null,
        owner_token: 'retryable-owner-token',
      });

      await expect(
        repository.completeCatalogSyncRun(run.id, {
          completedAt: new Date(3_000),
          status: 'SUCCESS',
          documentsChecked: 0,
          documentsAdded: 0,
          documentsUpdated: 0,
          documentsUnchanged: 0,
          documentsFailed: 0,
        }),
      ).resolves.toMatchObject({ status: 'SUCCESS', completedAt: new Date(3_000) });
      expect(readSyncRun(path, run.id)).toMatchObject({
        status: 'SUCCESS',
        owner_token: null,
      });
    },
  );

  it('keeps a file lease retryable when releasing the lock fails transiently', () => {
    const lockPath = createPath('lease-retry', 'maintenance.lock');
    let unlinkAttempts = 0;
    const lease = new FileLeaseLock(lockPath, {
      staleAfterMs: 1_000,
      clock,
      ownerTokenFactory: () => 'retryable-file-owner',
      unlinkFile: (path) => {
        unlinkAttempts += 1;
        if (unlinkAttempts === 1) {
          const error = new Error('transient unlink failure') as NodeJS.ErrnoException;
          error.code = 'EBUSY';
          throw error;
        }
        unlinkSync(path);
      },
    }).acquire();

    expect(() => lease.release()).toThrow('transient unlink failure');
    expect(existsSync(lockPath)).toBe(true);
    expect(() => lease.renew()).not.toThrow();

    expect(() => lease.release()).not.toThrow();
    expect(unlinkAttempts).toBe(2);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(`${lockPath}.heartbeat`)).toBe(false);
  });

  it(
    'never purges a staged pending-current version and still allows its later promotion',
    async () => {
      const path = createPath('pending-purge', 'catalog.db');
      const repository = new SqliteCatalogRepository(path, clock);
      closeables.push(repository);
      const source = await repository.addSource({
        sourceKey: 'docs',
        displayName: 'Documentation',
        baseUrl: 'https://example.test/',
        sourceType: 'documentation',
        language: 'en',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      });
      const document = await repository.upsertDocument({
        publicId: 'pending-purge-doc',
        sourceId: source.id,
        canonicalUrl: 'https://example.test/pending-purge',
        stableKey: 'pending-purge',
        title: 'Pending purge',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      });
      const current = await repository.addDocumentVersion({
        documentId: document.id,
        contentHash: 'current-v1',
        isCurrent: true,
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      });
      await repository.replaceDocumentSections(current.id, [section('current-section', 'Current')]);

      const pending = await repository.addDocumentVersion({
        documentId: document.id,
        contentHash: 'pending-v2',
        isCurrent: true,
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      });
      expect(pending.isCurrent).toBe(false);

      const purger = new SqliteCatalogVersionPurger(path, clock);
      closeables.push(purger);
      await expect(
        purger.purgeOldDocumentVersions({ keepPreviousVersions: 0, dryRun: false }),
      ).resolves.toMatchObject({ candidateVersions: 0, purgedVersions: 0 });

      expect(readVersionState(path, pending.id)).toEqual({ is_current: 0, pending_current: 1 });
      await repository.replaceDocumentSections(pending.id, [section('pending-section', 'Promoted')]);
      await expect(repository.getCurrentDocumentVersion(document.id)).resolves.toMatchObject({
        id: pending.id,
        isCurrent: true,
      });
      await expect(repository.verifyIntegrity()).resolves.toMatchObject({ issues: [] });
    },
  );

  it('hardens persistent search-history database and SQLite sidecars on POSIX', async () => {
    if (process.platform === 'win32') return;

    const path = createPath('history-permissions', join('private', 'history.sqlite'));
    const directory = dirname(path);
    const repository = new SqliteSearchHistoryRepository(path, clock, 90, 20_000);
    closeables.push(repository);

    chmodSync(path, 0o666);
    await repository.append(historyRecord());

    expect(permissionBits(path)).toBe(0o600);
    expect(permissionBits(directory) & 0o077).toBe(0);
    for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
      if (existsSync(sidecar)) expect(permissionBits(sidecar)).toBe(0o600);
    }
  });
});

function createPath(prefix: string, file: string): string {
  const root = mkdtempSync(join(tmpdir(), `mcp-residual-${prefix}-`));
  roots.push(root);
  return join(root, file);
}

function section(contentHash: string, content: string) {
  return {
    ordinal: 0,
    content,
    contentHash,
    characterCount: Array.from(content).length,
  };
}

function readSyncRun(path: string, id: number): SyncRunStateRow {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare<[number], SyncRunStateRow>(
        'SELECT status, completed_at, owner_token FROM sync_runs WHERE id = ?',
      )
      .get(id);
    if (row === undefined) throw new Error('SYNC_RUN_NOT_FOUND');
    return row;
  } finally {
    database.close();
  }
}

function readVersionState(path: string, id: number): VersionStateRow {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare<[number], VersionStateRow>(
        'SELECT is_current, pending_current FROM document_versions WHERE id = ?',
      )
      .get(id);
    if (row === undefined) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    return row;
  } finally {
    database.close();
  }
}

function permissionBits(path: string): number {
  return statSync(path).mode & 0o777;
}

function historyRecord(): SearchHistoryRecordInput {
  return {
    requestId: 'permission-test-request',
    tool: 'search_web',
    query: 'private local query',
    request: { language: 'en', maxResults: 5 },
    durationMs: 1,
    status: 'success',
    cacheStatus: 'MISS',
    provider: 'searxng',
    resultCount: 1,
    warningCodes: [],
  };
}
