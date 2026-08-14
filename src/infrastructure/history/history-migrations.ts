import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface HistoryMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const MIGRATION_FILE = /^H(\d{3})__([a-z0-9_]+)\.sql$/u;

export function loadHistoryMigrations(): readonly HistoryMigration[] {
  const directory = fileURLToPath(new URL('../../../history-migrations/', import.meta.url));
  return readdirSync(directory)
    .flatMap((name): HistoryMigration[] => {
      const match = MIGRATION_FILE.exec(name);
      if (match === null) return [];
      const version = Number.parseInt(match[1] ?? '', 10);
      if (!Number.isSafeInteger(version)) return [];
      const sql = readFileSync(
        new URL(name, new URL('../../../history-migrations/', import.meta.url)),
        'utf8',
      );
      return [
        {
          version,
          name,
          sql,
          checksum: checksumHistoryMigrationSql(sql),
        },
      ];
    })
    .sort((left, right) => left.version - right.version);
}

export function checksumHistoryMigrationSql(sql: string): string {
  const normalizedSql = sql.replaceAll('\r\n', '\n').replace(/^\uFEFF/u, '');
  return createHash('sha256').update(normalizedSql, 'utf8').digest('hex');
}
