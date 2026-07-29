import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import type { Logger } from '../../application/ports/logger.js';
import type {
  CatalogMaintenanceInput,
  CatalogMaintenanceOutput,
  CatalogMaintenanceRunner,
} from '../../application/use-cases/maintain-catalog.js';
import { openCatalogDatabase } from './catalog-database.js';
import { CatalogMigrationRunner } from './catalog-migration-runner.js';
import { FileLeaseLock, FileLeaseLockError } from '../locking/file-lease-lock.js';
import type { FileLease } from '../locking/file-lease-lock.js';

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

    return Promise.resolve().then(() =>
      this.withExclusiveLock(lockPath, input.staleLockMs, (renewLock) => {
        this.logger?.info('catalog_maintenance_started', {
          catalogPath: this.catalogPath,
          keepSyncRuns: input.keepSyncRuns,
          maxSyncRunAgeDays: input.maxSyncRunAgeDays,
          vacuum: input.vacuum,
        });

        const database = openCatalogDatabase(this.catalogPath);
        try {
          renewLock();
          new CatalogMigrationRunner(database, this.clock).apply();

          const syncRunsBefore = this.countSyncRuns(database);
          const syncRunsDeleted = this.deleteExpiredSyncRuns(database, input);
          const syncRunsAfter = this.countSyncRuns(database);

          renewLock();
          database.pragma('analysis_limit = 400');
          database.pragma('optimize');
          renewLock();
          database.pragma('wal_checkpoint(TRUNCATE)');
          if (input.vacuum) {
            renewLock();
            database.exec('VACUUM');
          }
          renewLock();

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

  private withExclusiveLock<T>(
    lockPath: string,
    staleLockMs: number,
    action: (renewLock: () => void) => T,
  ): T {
    const lock = new FileLeaseLock(lockPath, {
      staleAfterMs: staleLockMs,
      clock: this.clock,
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    });
    let lease: FileLease;
    try {
      lease = lock.acquire();
    } catch (error) {
      if (error instanceof FileLeaseLockError) {
        throw new CatalogMaintenanceLockError(error.message);
      }
      throw error;
    }

    try {
      return action(() => lease.renew());
    } finally {
      lease.release();
    }
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
