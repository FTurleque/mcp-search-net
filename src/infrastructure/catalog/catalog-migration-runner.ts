import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { loadCatalogMigrations, type CatalogMigration } from './catalog-migrations.js';

interface CatalogMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string | null;
}

export class CatalogMigrationRunner {
  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
    private readonly migrations: readonly CatalogMigration[] = loadCatalogMigrations(),
  ) {}

  public apply(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      ) STRICT;
    `);

    const columns = this.database
      .prepare<[], { readonly name: string }>('PRAGMA table_info(catalog_schema_migrations)')
      .all();
    if (!columns.some((column) => column.name === 'checksum')) {
      this.database.exec('ALTER TABLE catalog_schema_migrations ADD COLUMN checksum TEXT;');
    }

    const selectMigration = this.database.prepare<[number], CatalogMigrationRow>(
      'SELECT version, name, checksum FROM catalog_schema_migrations WHERE version = ?',
    );
    const recordMigration = this.database.prepare<[number, string, number, string]>(
      'INSERT INTO catalog_schema_migrations(version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
    );
    const baselineMigration = this.database.prepare<[string, number]>(
      'UPDATE catalog_schema_migrations SET checksum = ? WHERE version = ?',
    );

    this.database.transaction(() => {
      for (const migration of this.migrations) {
        const applied = selectMigration.get(migration.version);
        if (applied !== undefined) {
          assertAppliedMigrationMatches(applied, migration);
          if (applied.checksum === null) {
            baselineMigration.run(migration.checksum, migration.version);
          }
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
  applied: CatalogMigrationRow,
  migration: CatalogMigration,
): void {
  if (applied.name !== migration.name) {
    throw new Error(
      `CATALOG_MIGRATION_NAME_MISMATCH:${migration.version}:${applied.name}:${migration.name}`,
    );
  }
  if (applied.checksum !== null && applied.checksum !== migration.checksum) {
    throw new Error(`CATALOG_MIGRATION_CHECKSUM_MISMATCH:${migration.version}:${migration.name}`);
  }
}
