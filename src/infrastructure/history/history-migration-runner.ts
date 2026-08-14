import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { loadHistoryMigrations, type HistoryMigration } from './history-migrations.js';

interface HistoryMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string | null;
}

export class HistoryMigrationRunner {
  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
    private readonly migrations: readonly HistoryMigration[] = loadHistoryMigrations(),
  ) {}

  public apply(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS history_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      ) STRICT;
    `);

    const selectMigration = this.database.prepare<[number], HistoryMigrationRow>(
      'SELECT version, name, checksum FROM history_schema_migrations WHERE version = ?',
    );
    const recordMigration = this.database.prepare<[number, string, number, string]>(
      'INSERT INTO history_schema_migrations(version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
    );

    this.database.transaction(() => {
      for (const migration of this.migrations) {
        const applied = selectMigration.get(migration.version);
        if (applied !== undefined) {
          assertAppliedMigrationMatches(applied, migration);
          continue;
        }
        this.database.exec(migration.sql);
        recordMigration.run(
          migration.version,
          migration.name,
          this.clock.now().getTime(),
          migration.checksum,
        );
      }
    })();
  }
}

function assertAppliedMigrationMatches(
  applied: HistoryMigrationRow,
  migration: HistoryMigration,
): void {
  if (applied.name !== migration.name) {
    throw new Error(
      `HISTORY_MIGRATION_NAME_MISMATCH:${migration.version}:${applied.name}:${migration.name}`,
    );
  }
  if (applied.checksum !== null && applied.checksum !== migration.checksum) {
    throw new Error(`HISTORY_MIGRATION_CHECKSUM_MISMATCH:${migration.version}:${migration.name}`);
  }
}
