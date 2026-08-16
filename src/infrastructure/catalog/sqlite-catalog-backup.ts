import { createHash } from 'node:crypto';
import { createReadStream, existsSync, linkSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { hardenPrivateFile, preparePrivateDirectory } from '../sqlite-storage-permissions.js';
import { verifyCatalogIntegrity } from './catalog-integrity.js';
import { openCatalogDatabase } from './catalog-database.js';

const SAFE_BACKUP_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.db$/u;
const SQLITE_TEMPORARY_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;
const DEFAULT_CLEANUP_ATTEMPTS = 3;
const DEFAULT_CLEANUP_RETRY_DELAY_MS = 25;

export interface CatalogBackupOutput {
  readonly schemaVersion: '1.0';
  readonly status: 'backed_up';
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly pages: number;
  readonly verifiedAt: string;
}

export interface CatalogBackupCleanupFailure {
  readonly path: string;
  readonly attempts: number;
  readonly error: unknown;
}

export interface SqliteCatalogBackupOptions {
  readonly removeFile?: (path: string) => void;
  readonly cleanupAttempts?: number;
  readonly cleanupRetryDelayMs?: number;
  readonly waitForRetry?: (delayMs: number) => Promise<void>;
  readonly onCleanupFailure?: (failure: CatalogBackupCleanupFailure) => void;
}

export class SqliteCatalogBackup {
  private readonly removeFile: (path: string) => void;
  private readonly cleanupAttempts: number;
  private readonly cleanupRetryDelayMs: number;
  private readonly waitForRetry: (delayMs: number) => Promise<void>;
  private readonly onCleanupFailure: (failure: CatalogBackupCleanupFailure) => void;

  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
    options: SqliteCatalogBackupOptions = {},
  ) {
    this.removeFile = options.removeFile ?? removeFile;
    this.cleanupAttempts = options.cleanupAttempts ?? DEFAULT_CLEANUP_ATTEMPTS;
    this.cleanupRetryDelayMs = options.cleanupRetryDelayMs ?? DEFAULT_CLEANUP_RETRY_DELAY_MS;
    this.waitForRetry = options.waitForRetry ?? waitForRetry;
    this.onCleanupFailure = options.onCleanupFailure ?? emitCleanupWarning;

    if (!Number.isSafeInteger(this.cleanupAttempts) || this.cleanupAttempts <= 0) {
      throw new RangeError('cleanupAttempts must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.cleanupRetryDelayMs) || this.cleanupRetryDelayMs < 0) {
      throw new RangeError('cleanupRetryDelayMs must be a non-negative safe integer');
    }
  }

  public async run(destinationRequest: string): Promise<CatalogBackupOutput> {
    const requestedSourcePath = resolve(this.catalogPath);
    if (!existsSync(requestedSourcePath)) throw new Error('CATALOG_BACKUP_SOURCE_NOT_FOUND');
    const sourcePath = realpathSync(requestedSourcePath);
    const fileName = validateBackupFileName(destinationRequest);
    const backupDirectory = join(dirname(sourcePath), 'backups');
    const finalPath = join(backupDirectory, fileName);
    if (existsSync(finalPath)) throw new Error('CATALOG_BACKUP_DESTINATION_EXISTS');

    preparePrivateDirectory(backupDirectory);
    const temporaryPath = join(
      backupDirectory,
      `.partial-${process.pid}-${this.clock.now().getTime()}-${fileName}`,
    );
    const source = openCatalogDatabase(sourcePath);
    try {
      const metadata = await source.backup(temporaryPath);
      source.close();

      hardenPrivateFile(temporaryPath);
      this.verifySnapshot(temporaryPath);
      const sha256 = await sha256File(temporaryPath);
      const bytes = statSync(temporaryPath).size;
      const output: CatalogBackupOutput = {
        schemaVersion: '1.0',
        status: 'backed_up',
        sourcePath,
        destinationPath: finalPath,
        bytes,
        sha256,
        pages: metadata.totalPages,
        verifiedAt: this.clock.now().toISOString(),
      };

      // The hard-link is the durable commit point. The temporary inode is already private and
      // verified, so the published name is immediately a complete 0600 snapshot. Cleanup runs in
      // finally with bounded retries and diagnostics; it can never turn publication into failure.
      linkSync(temporaryPath, finalPath);
      return output;
    } finally {
      if (source.open) source.close();
      await this.cleanupTemporaryFamily(temporaryPath);
    }
  }

  private verifySnapshot(path: string): void {
    const snapshot = new Database(path, { readonly: true, fileMustExist: true });
    try {
      snapshot.pragma('foreign_keys = ON');
      const report = verifyCatalogIntegrity(snapshot);
      if (report.issues.length > 0) throw new Error('CATALOG_BACKUP_INTEGRITY_FAILED');
    } finally {
      snapshot.close();
    }
  }

  private async cleanupTemporaryFamily(path: string): Promise<void> {
    for (const suffix of SQLITE_TEMPORARY_SUFFIXES) {
      await this.cleanupPath(`${path}${suffix}`);
    }
  }

  private async cleanupPath(path: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.cleanupAttempts; attempt += 1) {
      try {
        this.removeFile(path);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.cleanupAttempts) {
          await this.waitForRetry(this.cleanupRetryDelayMs * attempt);
        }
      }
    }

    try {
      this.onCleanupFailure({ path, attempts: this.cleanupAttempts, error: lastError });
    } catch {
      // Diagnostics are deliberately fail-open after the cleanup budget is exhausted. Publication
      // may already be committed, and a diagnostic sink must never falsify the business outcome.
    }
  }
}

function validateBackupFileName(value: string): string {
  const fileName = basename(value.trim());
  if (!SAFE_BACKUP_FILE_NAME.test(fileName)) {
    throw new Error('CATALOG_BACKUP_INVALID_FILE_NAME');
  }
  return fileName;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('end', resolveHash);
    stream.on('error', rejectHash);
  });
  return hash.digest('hex');
}

function removeFile(path: string): void {
  rmSync(path, { force: true });
}

function waitForRetry(delayMs: number): Promise<void> {
  return delay(delayMs);
}

function emitCleanupWarning(failure: CatalogBackupCleanupFailure): void {
  const detail =
    failure.error instanceof Error ? `${failure.error.name}: ${failure.error.message}` : String(failure.error);
  process.emitWarning(
    `Catalog backup temporary cleanup failed for ${failure.path} after ${failure.attempts} attempts`,
    {
      code: 'CATALOG_BACKUP_CLEANUP_FAILED',
      detail,
    },
  );
}
