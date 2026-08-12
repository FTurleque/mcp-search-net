import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const MIGRATION_FILE = /^V(\d{3})__([a-z0-9_]+)\.sql$/u;

export function loadMigrations(): readonly Migration[] {
  const directory = fileURLToPath(new URL('../../../migrations/', import.meta.url));
  return readdirSync(directory)
    .flatMap((name): Migration[] => {
      const match = MIGRATION_FILE.exec(name);
      if (match === null) return [];
      const version = Number.parseInt(match[1] ?? '', 10);
      if (!Number.isSafeInteger(version)) return [];
      const sql = readFileSync(
        new URL(name, new URL('../../../migrations/', import.meta.url)),
        'utf8',
      );
      return [
        {
          version,
          name,
          sql,
          checksum: createHash('sha256').update(sql).digest('hex'),
        },
      ];
    })
    .sort((left, right) => left.version - right.version);
}
