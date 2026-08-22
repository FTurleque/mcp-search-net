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
import type { FileLease, FileLeaseLockOptions } from '../locking/file-lease-lock.js';

const DEFAULT_LOCK_RELEASE_ATTEMPTS = 3;

interface CountRow {
  readonly count: number;
}

interface CatalogMaintenanceLock {
  acquire(): FileLease;
}

type CatalogMaintenanceLockFactory = (
  lockPath: string,
  options: FileLeaseLockOptions,
) => CatalogMaintenanceLock;

export interface SqliteCatalogMaintenanceOptions {
  readonly lockFactory?: CatalogMaintenanceLockFactory;
  readonly releaseAttempts?: number;
}

export class CatalogMaintenanceLockError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CatalogMaintenanceLockError';
  }
}

export class CatalogMaintenanceCheckpointError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CatalogMaintenanceCheckpointError';
  }
}

export class SqliteCatalogMaintenance implements CatalogMaintenanceRunner {
  private readonly releaseAttempts: number;

  public constructor(
    private readonly catalogPath: string,
    private readonly clock: Clock,
    private readonly logger?: Logger,
    private readonly options: SqliteCatalogMaintenanceOptions = {},
  ) {
    this.releaseAttempts = options.releaseAttempts ?? DEFAULT_LOCK_RELEASE_ATTEMPTS;
    if (!Number.isSafeInteger(this.releaseAttempts) || this.releaseAttempts <= 0) {
      throw new RangeError('releaseAttempts must be a positive safe integer');
    }
  }

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
          this.checkpointWal(database);
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
    const lockOptions: FileLeaseLockOptions = {
      staleAfterMs: staleLockMs,
      clock: this.clock,
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    };
    const lock =
      this.options.lockFactory?.(lockPath, lockOptions) ?? new FileLeaseLock(lockPath, lockOptions);
    let lease: FileLease;
    try {
      lease = lock.acquire();
    } catch (error) {
      if (error instanceof FileLeaseLockError) {
        throw new CatalogMaintenanceLockError(error.message);
      }
      throw error;
    }

    let actionFailed = false;
    let actionError: unknown;
    let result: T | undefined;
    try {
      result = action(() => lease.renew());
    } catch (error) {
      actionFailed = true;
      actionError = error;
    }

    try {
      this.releaseLease(lease);
    } catch (releaseError) {
      if (!actionFailed) throw releaseError;
      attachFinalizationFailure(actionError, releaseError);
    }

    if (actionFailed) throw actionError;
    return result as T;
  }

  private releaseLease(lease: FileLease): void {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.releaseAttempts; attempt += 1) {
      try {
        lease.release();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.releaseAttempts) {
          this.logger?.warning('catalog_maintenance_lock_release_retry', {
            attempt,
            maxAttempts: this.releaseAttempts,
          });
        }
      }
    }
    throw lastError;
  }

  private checkpointWal(database: Database.Database): void {
    const busy = database.pragma('wal_checkpoint(TRUNCATE)', { simple: true });
    if (busy !== 0) {
      throw new CatalogMaintenanceCheckpointError(
        'CATALOG_WAL_CHECKPOINT_BUSY: active SQLite readers prevented a complete TRUNCATE checkpoint',
      );
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
    const terminalRunFilter = `status <> 'RUNNING' AND completed_at IS NOT NULL`;
    const detachStalenessEvents = database.prepare<[number, number]>(
      `
        UPDATE staleness_events
        SET sync_run_id = NULL
        WHERE sync_run_id IN (
          SELECT id
          FROM sync_runs
          WHERE ${terminalRunFilter}
            AND started_at < ?
            AND id NOT IN (
              SELECT id
              FROM sync_runs
              WHERE ${terminalRunFilter}
              ORDER BY started_at DESC, id DESC
              LIMIT ?
            )
        )
      `,
    );
    const deleteSyncRuns = database.prepare<[number, number]>(
      `
        DELETE FROM sync_runs
        WHERE ${terminalRunFilter}
          AND started_at < ?
          AND id NOT IN (
            SELECT id
            FROM sync_runs
            WHERE ${terminalRunFilter}
            ORDER BY started_at DESC, id DESC
            LIMIT ?
          )
      `,
    );
    const retainEventsAndDeleteRuns = database.transaction(() => {
      detachStalenessEvents.run(threshold, input.keepSyncRuns);
      return deleteSyncRuns.run(threshold, input.keepSyncRuns).changes;
    });

    return retainEventsAndDeleteRuns.immediate();
  }
}

function attachFinalizationFailure(primaryError: unknown, releaseError: unknown): void {
  if (!(primaryError instanceof Error)) return;
  const cause =
    primaryError.cause === undefined
      ? releaseError
      : new AggregateError(
          [primaryError.cause, releaseError],
          'Catalog maintenance failure had an additional lock release failure',
        );
  Reflect.defineProperty(primaryError, 'cause', {
    configurable: true,
    value: cause,
  });
}
