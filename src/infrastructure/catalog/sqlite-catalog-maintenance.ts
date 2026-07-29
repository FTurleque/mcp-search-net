import type Database from 'better-sqlite3';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { Clock } from '../../application/ports/clock.js';
import type { Logger } from '../../application/ports/logger.js';
import type {
  CatalogMaintenanceInput,
  CatalogMaintenanceOutput,
  CatalogMaintenanceRunner,
} from '../../application/use-cases/maintain-catalog.js';
import { openCatalogDatabase } from './catalog-database.js';
import { CatalogMigrationRunner } from './catalog-migration-runner.js';

interface CountRow {
  readonly count: number;
}

export class CatalogMaintenanceLockError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CatalogMaintenanceLockError';
  }
}

export class SqliteCatalogMaintenance implements CatalogMaintenanceRunner {
  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
    private readonly logger?: Logger,
  ) {}

  public run(input: CatalogMaintenanceInput): Promise<CatalogMaintenanceOutput> {
    const startedAt = this.clock.now().getTime();
    const lockPath = `${this.catalogPath}.maintenance.lock`;

    return Promise.resolve(
      this.withExclusiveLock(lockPath, input.staleLockMs, () => {
        this.logger?.info('catalog_maintenance_started', {
          catalogPath: this.catalogPath,
          keepSyncRuns: input.keepSyncRuns,
          maxSyncRunAgeDays: input.maxSyncRunAgeDays,
          vacuum: input.vacuum,
        });

        const database = openCatalogDatabase(this.catalogPath);
        try {
          new CatalogMigrationRunner(database, this.clock).apply();

          const syncRunsBefore = this.countSyncRuns(database);
          const syncRunsDeleted = this.deleteExpiredSyncRuns(database, input);
          const syncRunsAfter = this.countSyncRuns(database);

          database.pragma('analysis_limit = 400');
          database.pragma('optimize');
          database.pragma('wal_checkpoint(TRUNCATE)');
          if (input.vacuum) database.exec('VACUUM');

          const result: CatalogMaintenanceOutput = {
            schemaVersion: '1.0',
            status: 'maintained',
            lock: { acquired: true, path: lockPath },
            retention: {
              keepSyncRuns: input.keepSyncRuns,
              maxSyncRunAgeDays: input.maxSyncRunAgeDays,
              syncRunsBefore,
              syncRunsDeleted,
              syncRunsAfter,
            },
            sqlite: {
              analyzed: true,
              optimized: true,
              walCheckpointed: true,
              vacuumed: input.vacuum,
            },
            durationMs: this.clock.now().getTime() - startedAt,
          };

          this.logger?.info('catalog_maintenance_completed', {
            status: result.status,
            syncRunsDeleted: result.retention.syncRunsDeleted,
            durationMs: result.durationMs,
          });

          return result;
        } catch (error) {
          this.logger?.error('catalog_maintenance_failed', { error });
          throw error;
        } finally {
          database.close();
        }
      }),
    );
  }

  private withExclusiveLock<T>(lockPath: string, staleLockMs: number, action: () => T): T {
    mkdirSync(dirname(lockPath), { recursive: true });
    this.removeStaleLock(lockPath, staleLockMs);

    let descriptor: number | undefined;
    try {
      descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, JSON.stringify({ createdAt: this.clock.now().toISOString() }));
      return action();
    } catch (error) {
      if (descriptor === undefined && isExistingFileError(error)) {
        throw new CatalogMaintenanceLockError(
          `Catalog maintenance lock already exists: ${lockPath}`,
        );
      }
      throw error;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        if (existsSync(lockPath)) unlinkSync(lockPath);
      }
    }
  }

  private removeStaleLock(lockPath: string, staleLockMs: number): void {
    if (!existsSync(lockPath)) return;
    const ageMs = this.clock.now().getTime() - statSync(lockPath).mtimeMs;
    if (ageMs <= staleLockMs) return;
    this.logger?.warning('catalog_maintenance_stale_lock_removed', { lockPath, ageMs });
    unlinkSync(lockPath);
  }

  private countSyncRuns(database: Database.Database): number {
    return (
      database.prepare<[], CountRow>('SELECT COUNT(*) AS count FROM sync_runs').get()?.count ?? 0
    );
  }

  private deleteExpiredSyncRuns(
    database: Database.Database,
    input: CatalogMaintenanceInput,
  ): number {
    const maxAgeMs = input.maxSyncRunAgeDays * 24 * 60 * 60 * 1_000;
    const threshold = this.clock.now().getTime() - maxAgeMs;
    const result = database
      .prepare<[number, number]>(
        `
          DELETE FROM sync_runs
          WHERE started_at < ?
            AND id NOT IN (
              SELECT id
              FROM sync_runs
              ORDER BY started_at DESC, id DESC
              LIMIT ?
            )
        `,
      )
      .run(threshold, input.keepSyncRuns);
    return result.changes;
  }
}

function isExistingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'EEXIST'
  );
}
