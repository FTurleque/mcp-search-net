import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface CatalogMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const CATALOG_MIGRATION_FILE = /^C(\d{3})__([a-z0-9_]+)\.sql$/u;
const CATALOG_MIGRATIONS_DIRECTORY = new URL('../../../catalog-migrations/', import.meta.url);

export function loadCatalogMigrations(): readonly CatalogMigration[] {
  const directory = fileURLToPath(CATALOG_MIGRATIONS_DIRECTORY);
  return readdirSync(directory)
    .flatMap((name): CatalogMigration[] => {
      const match = CATALOG_MIGRATION_FILE.exec(name);
      if (match === null) return [];
      const version = Number.parseInt(match[1] ?? '', 10);
      if (!Number.isSafeInteger(version)) return [];
      const sql = readFileSync(new URL(name, CATALOG_MIGRATIONS_DIRECTORY), 'utf8');
      return [
        {
          version,
          name,
          sql,
          checksum: checksumMigrationSql(sql),
        },
      ];
    })
    .sort((left, right) => left.version - right.version);
}

export function checksumMigrationSql(sql: string): string {
  const normalizedSql = sql.replaceAll('\r\n', '\n').replace(/^\uFEFF/u, '');
  return createHash('sha256').update(normalizedSql, 'utf8').digest('hex');
}
