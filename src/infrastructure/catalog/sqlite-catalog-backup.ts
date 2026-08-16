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
const CLEANUP_RETRY_DELAYS_MS = [25, 100] as const;
const TRANSIENT_CLEANUP_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

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

export interface CatalogBackupCleanupDiagnostic {
  readonly schemaVersion: '1.0';
  readonly event: 'catalog_backup_cleanup_failed';
  readonly path: string;
  readonly phase: 'pre_commit' | 'post_commit';
  readonly attempts: number;
  readonly errorCode?: string;
}

export interface SqliteCatalogBackupOptions {
  readonly removeFile?: (path: string) => void;
  readonly publishFile?: (temporaryPath: string, finalPath: string) => void;
  readonly waitForCleanupRetry?: (delayMs: number) => Promise<void>;
  readonly onCleanupDiagnostic?: (diagnostic: CatalogBackupCleanupDiagnostic) => void;
}

export class SqliteCatalogBackup {
  private readonly removeFile: (path: string) => void;
  private readonly publishFile: (temporaryPath: string, finalPath: string) => void;
  private readonly waitForCleanupRetry: (delayMs: number) => Promise<void>;
  private readonly onCleanupDiagnostic: (diagnostic: CatalogBackupCleanupDiagnostic) => void;

  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
    options: SqliteCatalogBackupOptions = {},
  ) {
    this.removeFile = options.removeFile ?? removeFile;
    this.publishFile = options.publishFile ?? publishFile;
    this.waitForCleanupRetry = options.waitForCleanupRetry ?? waitForCleanupRetry;
    this.onCleanupDiagnostic = options.onCleanupDiagnostic ?? writeCleanupDiagnostic;
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
    let committed = false;
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
      // verified, so the published name is immediately a complete 0600 snapshot. No operation
      // after this point is allowed to turn a successful publication into a reported failure.
      this.publishFile(temporaryPath, finalPath);
      committed = true;
      return output;
    } finally {
      if (source.open) source.close();
      await this.cleanupTemporaryFamily(temporaryPath, committed ? 'post_commit' : 'pre_commit');
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

  private async cleanupTemporaryFamily(
    path: string,
    phase: CatalogBackupCleanupDiagnostic['phase'],
  ): Promise<void> {
    for (const suffix of SQLITE_TEMPORARY_SUFFIXES) {
      await this.cleanupTemporaryPath(`${path}${suffix}`, phase);
    }
  }

  private async cleanupTemporaryPath(
    path: string,
    phase: CatalogBackupCleanupDiagnostic['phase'],
  ): Promise<void> {
    let lastError: unknown;
    let attempts = 0;

    for (let attempt = 0; attempt <= CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
      attempts = attempt + 1;
      try {
        this.removeFile(path);
        return;
      } catch (error) {
        lastError = error;
        const retryDelay = CLEANUP_RETRY_DELAYS_MS[attempt];
        if (!isTransientCleanupError(error) || retryDelay === undefined) break;
        try {
          await this.waitForCleanupRetry(retryDelay);
        } catch (waitError) {
          lastError = waitError;
          break;
        }
      }
    }

    this.emitCleanupDiagnostic(path, phase, attempts, lastError);
  }

  private emitCleanupDiagnostic(
    path: string,
    phase: CatalogBackupCleanupDiagnostic['phase'],
    attempts: number,
    error: unknown,
  ): void {
    const errorCode = cleanupErrorCode(error);
    const diagnostic: CatalogBackupCleanupDiagnostic = {
      schemaVersion: '1.0',
      event: 'catalog_backup_cleanup_failed',
      path,
      phase,
      attempts,
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    try {
      this.onCleanupDiagnostic(diagnostic);
    } catch {
      // Diagnostics are intentionally non-fatal: a sink failure must not hide the primary backup
      // failure or turn an already committed backup into a false negative.
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

function publishFile(temporaryPath: string, finalPath: string): void {
  linkSync(temporaryPath, finalPath);
}

function removeFile(path: string): void {
  rmSync(path, { force: true });
}

async function waitForCleanupRetry(delayMs: number): Promise<void> {
  await delay(delayMs);
}

function isTransientCleanupError(error: unknown): boolean {
  return TRANSIENT_CLEANUP_ERROR_CODES.has(cleanupErrorCode(error) ?? '');
}

function cleanupErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && code !== '' ? code : undefined;
}

function writeCleanupDiagnostic(diagnostic: CatalogBackupCleanupDiagnostic): void {
  process.stderr.write(`${JSON.stringify({ level: 'warn', ...diagnostic })}\n`);
}
