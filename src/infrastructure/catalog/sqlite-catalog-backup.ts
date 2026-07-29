import { createHash } from 'node:crypto';
import { createReadStream, existsSync, linkSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { verifyCatalogIntegrity } from './catalog-integrity.js';
import { openCatalogDatabase } from './catalog-database.js';

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

export class SqliteCatalogBackup {
  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
  ) {}

  public async run(destinationPath: string): Promise<CatalogBackupOutput> {
    const sourcePath = resolve(this.catalogPath);
    const finalPath = resolve(destinationPath);
    if (!existsSync(sourcePath)) throw new Error('CATALOG_BACKUP_SOURCE_NOT_FOUND');
    if (sourcePath === finalPath) throw new Error('CATALOG_BACKUP_DESTINATION_IS_SOURCE');
    if (existsSync(finalPath)) throw new Error('CATALOG_BACKUP_DESTINATION_EXISTS');

    mkdirSync(dirname(finalPath), { recursive: true });
    const temporaryPath = `${finalPath}.partial-${process.pid}-${this.clock.now().getTime()}`;
    const source = openCatalogDatabase(sourcePath);
    try {
      const metadata = await source.backup(temporaryPath);
      this.verifySnapshot(temporaryPath);
      const sha256 = await sha256File(temporaryPath);
      const bytes = statSync(temporaryPath).size;

      // The temporary file is created beside the destination. A hard link publishes the
      // fully verified snapshot atomically and fails rather than replacing an existing file.
      linkSync(temporaryPath, finalPath);
      rmSync(temporaryPath);

      return {
        schemaVersion: '1.0',
        status: 'backed_up',
        sourcePath,
        destinationPath: finalPath,
        bytes,
        sha256,
        pages: metadata.totalPages,
        verifiedAt: this.clock.now().toISOString(),
      };
    } finally {
      source.close();
      rmSync(temporaryPath, { force: true });
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
