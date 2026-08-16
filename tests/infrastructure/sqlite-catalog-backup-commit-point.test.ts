import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogBackup } from '../../src/infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const clock = { now: () => new Date('2026-08-16T18:00:00.000Z') };

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogBackup commit point', () => {
  it('keeps a published backup successful when temporary cleanup fails after commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-backup-commit-'));
    roots.push(root);
    const catalogPath = join(root, 'catalog.db');
    const catalog = new SqliteCatalogRepository(catalogPath, clock);
    await catalog.addSource({
      sourceKey: 'docs',
      displayName: 'Documentation',
      baseUrl: 'https://docs.example/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    catalog.close();

    const backup = new SqliteCatalogBackup(catalogPath, clock, {
      removeFile: () => {
        const error = new Error('transient cleanup failure') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      },
    });

    const result = await backup.run('committed.db');

    expect(result.status).toBe('backed_up');
    expect(existsSync(result.destinationPath)).toBe(true);
    expect(readFileSync(result.destinationPath).byteLength).toBe(result.bytes);
    const snapshot = new Database(result.destinationPath, { readonly: true, fileMustExist: true });
    try {
      expect(
        snapshot.prepare<[], { source_key: string }>('SELECT source_key FROM catalog_sources').get()
          ?.source_key,
      ).toBe('docs');
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      snapshot.close();
    }
  });
});
