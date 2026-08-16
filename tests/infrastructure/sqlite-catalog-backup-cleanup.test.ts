import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogBackupCleanupDiagnostic } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogBackup } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T21:00:00.000Z') };
const temporarySuffixes = ['', '-wal', '-shm', '-journal'] as const;

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogBackup cleanup resilience', () => {
  it('removes the temporary SQLite family after a normal backup', async () => {
    const fixture = await createCatalog('normal');

    const result = await new SqliteCatalogBackup(fixture.catalogPath, clock).run('normal.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect(partialArtifacts(fixture.root)).toEqual([]);
  });

  it('retries one transient EPERM per family member and completes without a persistent diagnostic', async () => {
    const fixture = await createCatalog('retry-once');
    const calls = new Map<string, number>();
    const waits: number[] = [];
    const diagnostics: CatalogBackupCleanupDiagnostic[] = [];

    const result = await new SqliteCatalogBackup(fixture.catalogPath, clock, {
      publishFile: publishWithSidecars,
      removeFile: (path) => {
        const attempt = recordAttempt(calls, path);
        if (attempt === 1) throw errnoError('EPERM');
        rmSync(path, { force: true });
      },
      waitForCleanupRetry: async (delayMs) => {
        waits.push(delayMs);
      },
      onCleanupDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).run('retry-once.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect([...calls.values()]).toEqual([2, 2, 2, 2]);
    expect(waits).toEqual([25, 25, 25, 25]);
    expect(diagnostics).toEqual([]);
    expect(partialArtifacts(fixture.root)).toEqual([]);
  });

  it('recovers after multiple transient failures within the bounded retry budget', async () => {
    const fixture = await createCatalog('retry-twice');
    const calls = new Map<string, number>();
    const waits: number[] = [];
    const diagnostics: CatalogBackupCleanupDiagnostic[] = [];

    const result = await new SqliteCatalogBackup(fixture.catalogPath, clock, {
      publishFile: publishWithSidecars,
      removeFile: (path) => {
        const attempt = recordAttempt(calls, path);
        if (attempt < 3) throw errnoError('EBUSY');
        rmSync(path, { force: true });
      },
      waitForCleanupRetry: async (delayMs) => {
        waits.push(delayMs);
      },
      onCleanupDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).run('retry-twice.db');

    expect(result.status).toBe('backed_up');
    expect([...calls.values()]).toEqual([3, 3, 3, 3]);
    expect(waits).toEqual([25, 100, 25, 100, 25, 100, 25, 100]);
    expect(diagnostics).toEqual([]);
    expect(partialArtifacts(fixture.root)).toEqual([]);
  });

  it('keeps a committed backup valid and emits one bounded diagnostic per persistent family failure', async () => {
    const fixture = await createCatalog('persistent');
    const calls = new Map<string, number>();
    const diagnostics: CatalogBackupCleanupDiagnostic[] = [];

    const result = await new SqliteCatalogBackup(fixture.catalogPath, clock, {
      publishFile: publishWithSidecars,
      removeFile: (path) => {
        recordAttempt(calls, path);
        throw errnoError('EPERM');
      },
      waitForCleanupRetry: async () => undefined,
      onCleanupDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).run('persistent.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect([...calls.values()]).toEqual([3, 3, 3, 3]);
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics).toEqual(
      diagnostics.map((diagnostic) => ({
        schemaVersion: '1.0',
        event: 'catalog_backup_cleanup_failed',
        path: diagnostic.path,
        phase: 'post_commit',
        attempts: 3,
        errorCode: 'EPERM',
      })),
    );
    const temporaryBase = diagnostics[0]?.path;
    expect(temporaryBase).toBeDefined();
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      temporarySuffixes.map((suffix) => `${temporaryBase}${suffix}`),
    );
    expect(partialArtifacts(fixture.root)).toHaveLength(4);

    const snapshot = new Database(result.destinationPath, { readonly: true, fileMustExist: true });
    try {
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(
        snapshot.prepare<[], { readonly source_key: string }>('SELECT source_key FROM catalog_sources').get()
          ?.source_key,
      ).toBe('docs');
    } finally {
      snapshot.close();
    }
  });

  it('preserves a primary pre-commit failure when cleanup also fails persistently', async () => {
    const fixture = await createCatalog('primary-error');
    const primaryError = new Error('PRIMARY_PUBLISH_FAILURE');
    const calls = new Map<string, number>();
    const diagnostics: CatalogBackupCleanupDiagnostic[] = [];

    const backup = new SqliteCatalogBackup(fixture.catalogPath, clock, {
      publishFile: (temporaryPath) => {
        writeSidecars(temporaryPath);
        throw primaryError;
      },
      removeFile: (path) => {
        recordAttempt(calls, path);
        throw errnoError('EBUSY');
      },
      waitForCleanupRetry: async () => undefined,
      onCleanupDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(backup.run('never-published.db')).rejects.toBe(primaryError);
    expect(existsSync(join(fixture.root, 'backups', 'never-published.db'))).toBe(false);
    expect([...calls.values()]).toEqual([3, 3, 3, 3]);
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics.every((diagnostic) => diagnostic.phase === 'pre_commit')).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.errorCode === 'EBUSY')).toBe(true);
  });
});

async function createCatalog(label: string): Promise<{
  readonly root: string;
  readonly catalogPath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), `mcp-catalog-backup-cleanup-${label}-`));
  roots.push(root);
  const catalogPath = join(root, 'catalog.db');
  const repository = new SqliteCatalogRepository(catalogPath, clock);
  await repository.addSource({
    sourceKey: 'docs',
    displayName: 'Documentation',
    baseUrl: 'https://docs.example/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  repository.close();
  return { root, catalogPath };
}

function publishWithSidecars(temporaryPath: string, finalPath: string): void {
  writeSidecars(temporaryPath);
  linkSync(temporaryPath, finalPath);
}

function writeSidecars(temporaryPath: string): void {
  for (const suffix of temporarySuffixes.slice(1)) {
    writeFileSync(`${temporaryPath}${suffix}`, suffix, 'utf8');
  }
}

function recordAttempt(calls: Map<string, number>, path: string): number {
  const attempt = (calls.get(path) ?? 0) + 1;
  calls.set(path, attempt);
  return attempt;
}

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function partialArtifacts(root: string): readonly string[] {
  const backupDirectory = join(root, 'backups');
  if (!existsSync(backupDirectory)) return [];
  return readdirSync(backupDirectory).filter((name) => name.startsWith('.partial-')).sort();
}