import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogBackup } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

describe('SqliteCatalogBackup', () => {
  afterEach(() => {
    catalogs.splice(0).forEach((catalog) => catalog.close());
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('creates a verified snapshot while an uncommitted WAL writer is active', async () => {
    const fixture = createCatalogFixture();
    await fixture.catalog.addSource({
      sourceKey: 'committed',
      displayName: 'Committed',
      baseUrl: 'https://docs.example.com',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });

    const writer = new Database(fixture.path);
    writer.pragma('journal_mode = WAL');
    writer.exec('BEGIN IMMEDIATE');
    writer
      .prepare(
        `INSERT INTO catalog_sources (
          id, source_key, display_name, base_url, source_type, language,
          freshness_policy, sync_strategy, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        999_999,
        'uncommitted',
        'Uncommitted',
        'https://uncommitted.example.com',
        'documentation',
        'en',
        'manual',
        'manual',
        1,
        1,
        1,
      );

    const destination = join(fixture.root, 'backups', 'catalog.snapshot.db');
    try {
      const result = await new SqliteCatalogBackup(fixture.path, {
        now: () => new Date('2026-07-29T12:00:00.000Z'),
      }).run(destination);
      const snapshot = new Database(destination, { readonly: true });
      try {
        const sourceKeys = snapshot
          .prepare<[], { source_key: string }>(
            'SELECT source_key FROM catalog_sources ORDER BY source_key',
          )
          .all()
          .map((row) => row.source_key);
        expect(sourceKeys).toEqual(['committed']);
      } finally {
        snapshot.close();
      }
      expect(result).toMatchObject({ status: 'backed_up', destinationPath: destination });
      expect(result.sha256).toBe(
        createHash('sha256').update(readFileSync(destination)).digest('hex'),
      );
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
  });

  it('confines an arbitrary requested path to the catalog backup directory', async () => {
    const fixture = createCatalogFixture();
    const requestedOutsidePath = join(dirname(fixture.root), 'escaped.db');
    const expectedPath = join(fixture.root, 'backups', 'escaped.db');

    const result = await new SqliteCatalogBackup(fixture.path, fixture.clock).run(
      requestedOutsidePath,
    );

    expect(result.destinationPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(requestedOutsidePath)).toBe(false);
  });

  it('rejects unsafe backup file names and never overwrites an existing destination', async () => {
    const fixture = createCatalogFixture();
    await expect(
      new SqliteCatalogBackup(fixture.path, fixture.clock).run('invalid name.db'),
    ).rejects.toThrow('CATALOG_BACKUP_INVALID_FILE_NAME');

    const destination = join(fixture.root, 'backups', 'existing.db');
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, 'keep-me');

    await expect(
      new SqliteCatalogBackup(fixture.path, fixture.clock).run(destination),
    ).rejects.toThrow('CATALOG_BACKUP_DESTINATION_EXISTS');
    expect(readFileSync(destination, 'utf8')).toBe('keep-me');
  });
});

function createCatalogFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-backup-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const catalog = new SqliteCatalogRepository(path, clock);
  catalogs.push(catalog);
  return { catalog, clock, path, root };
}
