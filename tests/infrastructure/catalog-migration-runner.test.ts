import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import {
  checksumMigrationSql,
  loadCatalogMigrations,
  type CatalogMigration,
} from '../../src/infrastructure/catalog/catalog-migrations.js';
import { CatalogMigrationRunner } from '../../src/infrastructure/catalog/catalog-migration-runner.js';

const clock: Clock = { now: () => new Date(1_000) };

describe('CatalogMigrationRunner', () => {
  it('safely baselines checksums for the legacy registry and then rejects SQL drift', () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE catalog_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      INSERT INTO catalog_schema_migrations(version, name, applied_at)
      VALUES (1, 'C001__sample.sql', 1);
    `);
    const original = migration(1, 'C001__sample.sql', 'CREATE TABLE sample(id INTEGER);');

    new CatalogMigrationRunner(database, clock, [original]).apply();

    const applied = database
      .prepare('SELECT checksum FROM catalog_schema_migrations WHERE version = 1')
      .get() as { checksum: string };
    expect(applied.checksum).toBe(original.checksum);

    const modified = migration(
      1,
      'C001__sample.sql',
      'CREATE TABLE sample(id INTEGER, changed TEXT);',
    );
    expect(() => new CatalogMigrationRunner(database, clock, [modified]).apply()).toThrow(
      'CATALOG_MIGRATION_CHECKSUM_MISMATCH:1:C001__sample.sql',
    );
    database.close();
  });

  it('normalizes checkout line endings before hashing migration SQL', () => {
    expect(checksumMigrationSql('SELECT 1;\r\n')).toBe(checksumMigrationSql('SELECT 1;\n'));
  });

  it('upgrades an existing C001-C006 catalog without losing its migration history', () => {
    const database = new Database(':memory:');
    const migrations = loadCatalogMigrations();
    database.exec(`
      CREATE TABLE catalog_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);
    const record = database.prepare(
      'INSERT INTO catalog_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
    );
    for (const migrationEntry of migrations.filter(({ version }) => version <= 6)) {
      database.exec(migrationEntry.sql);
      record.run(migrationEntry.version, migrationEntry.name, 1);
    }

    new CatalogMigrationRunner(database, clock, migrations).apply();

    const applied = database
      .prepare('SELECT version, checksum FROM catalog_schema_migrations ORDER BY version')
      .all() as { version: number; checksum: string }[];
    const ftsDefinition = database
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'document_section_fts'")
      .get() as { sql: string };
    expect(applied.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(applied.every(({ checksum }) => checksum.length === 64)).toBe(true);
    expect(ftsDefinition.sql).toContain('contentless_delete = 1');
    database.close();
  });
});

function migration(version: number, name: string, sql: string): CatalogMigration {
  return { version, name, sql, checksum: checksumMigrationSql(sql) };
}
