import { createHash } from 'node:crypto';
import { createReadStream, existsSync, linkSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { hardenPrivateFile, preparePrivateDirectory } from '../sqlite-storage-permissions.js';
import { verifyCatalogIntegrity } from './catalog-integrity.js';
import { openCatalogDatabase } from './catalog-database.js';

const SAFE_BACKUP_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.db$/u;
const SQLITE_TEMPORARY_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;

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
  readonly removeFile?: (path: string) => void;
}

export class SqliteCatalogBackup {
  private readonly removeFile: (path: string) => void;

  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
    options: SqliteCatalogBackupOptions = {},
  ) {
    this.removeFile = options.removeFile ?? removeFile;
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
      // verified, so the published name is immediately a complete 0600 snapshot. No operation
      // after this point is allowed to turn a successful publication into a reported failure.
      linkSync(temporaryPath, finalPath);
      this.cleanupTemporaryFamily(temporaryPath);
      return output;
    } finally {
      if (source.open) source.close();
      this.cleanupTemporaryFamily(temporaryPath);
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

  private cleanupTemporaryFamily(path: string): void {
    for (const suffix of SQLITE_TEMPORARY_SUFFIXES) {
      try {
        this.removeFile(`${path}${suffix}`);
      } catch {
        // Publication is already committed or a primary error is already in flight. Cleanup is
        // deliberately best effort so a transient EPERM/EBUSY cannot falsify the backup outcome.
      }
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
