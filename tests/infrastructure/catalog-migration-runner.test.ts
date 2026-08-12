import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports/clock.js';
import {
  checksumMigrationSql,
  loadCatalogMigrations,
  type CatalogMigration,
} from '../../src/infrastructure/catalog/catalog-migrations.js';
import { CatalogMigrationRunner } from '../../src/infrastructure/catalog/catalog-migration-runner.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

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
    const syncColumns = database
      .prepare("SELECT name FROM pragma_table_info('sync_runs') ORDER BY cid")
      .all() as { name: string }[];
    const versionColumns = database
      .prepare("SELECT name FROM pragma_table_info('document_versions') ORDER BY cid")
      .all() as { name: string }[];
    expect(applied.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(applied.every(({ checksum }) => checksum.length === 64)).toBe(true);
    expect(ftsDefinition.sql).toContain('contentless_delete = 1');
    expect(syncColumns.map(({ name }) => name)).toContain('run_kind');
    expect(versionColumns.map(({ name }) => name)).toContain('pending_current');
    database.close();
  });

  it('upgrades C008 in place, preserves section ids, rebuilds FTS and adds run kind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-c009-upgrade-'));
    const path = join(root, 'catalog.db');
    let database = new Database(path);
    try {
      const migrations = loadCatalogMigrations();
      new CatalogMigrationRunner(
        database,
        clock,
        migrations.filter(({ version }) => version <= 8),
      ).apply();
      database.exec(`
        INSERT INTO catalog_sources(
          id, source_key, display_name, base_url, source_type, language,
          freshness_policy, sync_strategy, enabled, created_at, updated_at
        ) VALUES (1, 'legacy', 'Legacy', 'https://example.test/', 'documentation',
          'en', 'manual', 'manual', 1, 1, 1);
        INSERT INTO documents(
          id, public_id, source_id, canonical_url, stable_key, title, mime_type,
          language, status, first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (10, 'legacy-guide', 1, 'https://example.test/guide', 'guide',
          'Legacy guide', 'text/markdown', 'en', 'ACTIVE', 1, 1, 1, 1);
        INSERT INTO document_versions(
          id, document_id, content_hash, fetched_at, is_current,
          extraction_mode, content_type, metadata_json
        ) VALUES (20, 10, 'legacy-version', 1, 1, 'static', 'text/markdown', '{}');
        INSERT INTO document_sections(
          id, document_version_id, ordinal, heading, heading_path, heading_level,
          anchor, content, content_hash, character_count, token_count
        ) VALUES (30, 20, 0, 'Legacy', 'Legacy', 1, 'legacy',
          'migration searchable sentinel', 'legacy-section', 29, 3);
        UPDATE documents SET current_version_id = 20 WHERE id = 10;
        INSERT INTO document_section_fts(
          rowid, section_id, document_id, source_key, language,
          title, heading, heading_path, content
        ) VALUES (30, 30, 10, 'legacy', 'en', 'Legacy guide', 'Legacy', 'Legacy',
          'migration searchable sentinel');
        INSERT INTO sync_runs(
          source_id, started_at, completed_at, status,
          documents_checked, documents_added, documents_updated,
          documents_unchanged, documents_failed, error_summary
        ) VALUES (1, 1, 2, 'SUCCESS', 1, 1, 0, 0, 0, NULL);
      `);
      database.close();

      const repository = new SqliteCatalogRepository(path, clock);
      await expect(repository.verifyIntegrity()).resolves.toMatchObject({
        counts: { currentSections: 1, indexedSections: 1 },
        issues: [],
      });
      await expect(
        repository.searchDocuments({ query: 'searchable sentinel' }),
      ).resolves.toMatchObject([{ section: { id: 30, content: 'migration searchable sentinel' } }]);
      repository.close();

      database = new Database(path, { readonly: true });
      const versions = database
        .prepare('SELECT version FROM catalog_schema_migrations ORDER BY version')
        .all() as { version: number }[];
      const sectionSql = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_sections'",
        )
        .get() as { sql: string };
      const legacyRun = database.prepare('SELECT run_kind FROM sync_runs LIMIT 1').get() as {
        run_kind: string;
      };
      const legacyVersion = database
        .prepare('SELECT pending_current FROM document_versions WHERE id = 20')
        .get() as { pending_current: number };
      expect(versions.map(({ version }) => version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      expect(sectionSql.sql).not.toContain('UNIQUE (document_version_id, content_hash)');
      expect(legacyRun.run_kind).toBe('EXECUTION');
      expect(legacyVersion.pending_current).toBe(0);
    } finally {
      if (database.open) database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function migration(version: number, name: string, sql: string): CatalogMigration {
  return { version, name, sql, checksum: checksumMigrationSql(sql) };
}
