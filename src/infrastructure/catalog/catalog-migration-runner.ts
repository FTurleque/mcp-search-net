import type Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import { loadCatalogMigrations } from './catalog-migrations.js';

interface CatalogMigrationRow {
  readonly version: number;
}

export class CatalogMigrationRunner {
  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
  ) {}

  public apply(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);

    const hasMigration = this.database.prepare<[number], CatalogMigrationRow>(
      'SELECT version FROM catalog_schema_migrations WHERE version = ?',
    );
    const recordMigration = this.database.prepare<[number, string, number]>(
      'INSERT INTO catalog_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
    );

    this.database.transaction(() => {
      for (const migration of loadCatalogMigrations()) {
        if (hasMigration.get(migration.version) !== undefined) continue;
        this.database.exec(migration.sql);
        recordMigration.run(migration.version, migration.name, this.clock.now().getTime());
      }
    })();
  }
}
