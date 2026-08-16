import { createHash } from 'node:crypto';
import { createReadStream, existsSync, linkSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { hardenPrivateFile, preparePrivateDirectory } from '../sqlite-storage-permissions.js';
import { verifyCatalogIntegrity } from './catalog-integrity.js';
import { openCatalogDatabase } from './catalog-database.js';

const SAFE_BACKUP_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.db$/u;
const BACKUP_TEMP_CLEANUP_ATTEMPTS = 3;

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

export interface SqliteCatalogBackupOptions {
  readonly removeTemporaryFile?: (path: string) => void;
  readonly onTemporaryCleanupFailure?: (path: string, error: unknown) => void;
}

export class SqliteCatalogBackup {
  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
    private readonly options: SqliteCatalogBackupOptions = {},
  ) {}

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

    try {
      const source = openCatalogDatabase(sourcePath);
      let pages: number;
      try {
        const metadata = await source.backup(temporaryPath);
        pages = metadata.totalPages;
      } finally {
        source.close();
      }

      hardenPrivateFile(temporaryPath);
      this.verifySnapshot(temporaryPath);
      const sha256 = await sha256File(temporaryPath);
      const bytes = statSync(temporaryPath).size;
      const verifiedAt = this.clock.now().toISOString();
      const output: CatalogBackupOutput = {
        schemaVersion: '1.0',
        status: 'backed_up',
        sourcePath,
        destinationPath: finalPath,
        bytes,
        sha256,
        pages,
        verifiedAt,
      };

      // The hard-link creation is the no-overwrite commit point. The temporary file was already
      // hardened, verified and hashed; both names therefore refer to the same validated inode.
      linkSync(temporaryPath, finalPath);
      return output;
    } finally {
      this.cleanupTemporaryFile(temporaryPath);
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

  private cleanupTemporaryFile(path: string): void {
    const removeTemporaryFile =
      this.options.removeTemporaryFile ?? ((target: string) => rmSync(target, { force: true }));
    let lastError: unknown;

    for (let attempt = 1; attempt <= BACKUP_TEMP_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        removeTemporaryFile(path);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    try {
      if (this.options.onTemporaryCleanupFailure !== undefined) {
        this.options.onTemporaryCleanupFailure(path, lastError);
      } else {
        process.emitWarning(`CATALOG_BACKUP_TEMP_CLEANUP_FAILED: ${path}`);
      }
    } catch {
      // Backup publication/failure semantics must never be changed by diagnostic reporting.
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
