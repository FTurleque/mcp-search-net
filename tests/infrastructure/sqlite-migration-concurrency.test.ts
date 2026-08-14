import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMigrations, type Migration } from '../../src/infrastructure/cache/migrations.js';
import {
  loadCatalogMigrations,
  type CatalogMigration,
} from '../../src/infrastructure/catalog/catalog-migrations.js';
import {
  loadHistoryMigrations,
  type HistoryMigration,
} from '../../src/infrastructure/history/history-migrations.js';

type RepositoryKind = 'cache' | 'catalog' | 'history';
type AnyMigration = Migration | CatalogMigration | HistoryMigration;

interface MigrationSuite {
  readonly kind: RepositoryKind;
  readonly ledgerTable: string;
  readonly migrations: () => readonly AnyMigration[];
}

interface CountRow {
  readonly count: number;
}

const suites: readonly MigrationSuite[] = [
  { kind: 'cache', ledgerTable: 'schema_migrations', migrations: loadMigrations },
  {
    kind: 'catalog',
    ledgerTable: 'catalog_schema_migrations',
    migrations: loadCatalogMigrations,
  },
  {
    kind: 'history',
    ledgerTable: 'history_schema_migrations',
    migrations: loadHistoryMigrations,
  },
];
const roots: string[] = [];

 afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SQLite migration concurrency', () => {
  for (const suite of suites) {
    it(`serializes concurrent first-open migrations for ${suite.kind}`, async () => {
      const root = createRoot(suite.kind, 'first-open');
      const databasePath = join(root, `${suite.kind}.sqlite`);

      await openConcurrently(suite.kind, databasePath, root);

      assertMigrationLedger(databasePath, suite);
    });

    it(`serializes concurrent upgrade migrations for ${suite.kind}`, async () => {
      const migrations = suite.migrations();
      if (migrations.length < 2) return;
      const root = createRoot(suite.kind, 'upgrade');
      const databasePath = join(root, `${suite.kind}.sqlite`);
      prepareDatabaseBeforeLastMigration(databasePath, suite, migrations.slice(0, -1));

      await openConcurrently(suite.kind, databasePath, root);

      assertMigrationLedger(databasePath, suite);
    });
  }
});

function createRoot(kind: RepositoryKind, scenario: string): string {
  const root = mkdtempSync(join(tmpdir(), `mcp-${kind}-${scenario}-`));
  roots.push(root);
  return root;
}

async function openConcurrently(
  kind: RepositoryKind,
  databasePath: string,
  root: string,
): Promise<void> {
  const goPath = join(root, 'go');
  const readyOne = join(root, 'ready-1');
  const readyTwo = join(root, 'ready-2');
  const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'open-sqlite-repository.ts');
  const first = spawnRepository(kind, databasePath, readyOne, goPath, fixturePath);
  const second = spawnRepository(kind, databasePath, readyTwo, goPath, fixturePath);

  try {
    await Promise.all([
      waitForFile(readyOne, first),
      waitForFile(readyTwo, second),
    ]);
    writeFileSync(goPath, 'go\n', 'utf8');
    await Promise.all([waitForSuccess(first), waitForSuccess(second)]);
  } finally {
    if (first.exitCode === null) first.kill();
    if (second.exitCode === null) second.kill();
  }
}

function spawnRepository(
  kind: RepositoryKind,
  databasePath: string,
  readyPath: string,
  goPath: string,
  fixturePath: string,
): ChildProcess {
  return spawn(
    process.execPath,
    ['--import', 'tsx', fixturePath, kind, databasePath, readyPath, goPath],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
}

async function waitForFile(path: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (child.exitCode !== null) {
      throw new Error(`Migration fixture exited before readiness with code ${child.exitCode}`);
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await delay(10);
  }
}

async function waitForSuccess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error(`Migration fixture failed with code ${child.exitCode}`);
    return;
  }
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Migration fixture failed with code ${code}: ${stderr}`));
    });
  });
}

function prepareDatabaseBeforeLastMigration(
  databasePath: string,
  suite: MigrationSuite,
  migrations: readonly AnyMigration[],
): void {
  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = ON');
    createLedger(database, suite.kind);
    const transaction = database.transaction(() => {
      for (const migration of migrations) {
        database.exec(migration.sql);
        recordMigration(database, suite.kind, migration);
      }
    });
    transaction.immediate();
  } finally {
    database.close();
  }
}

function createLedger(database: Database.Database, kind: RepositoryKind): void {
  if (kind === 'cache') {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        name TEXT,
        checksum TEXT
      ) STRICT;
    `);
    return;
  }
  const table = kind === 'catalog' ? 'catalog_schema_migrations' : 'history_schema_migrations';
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    ) STRICT;
  `);
}

function recordMigration(
  database: Database.Database,
  kind: RepositoryKind,
  migration: AnyMigration,
): void {
  if (kind === 'cache') {
    database
      .prepare(
        'INSERT INTO schema_migrations(version, applied_at, name, checksum) VALUES (?, ?, ?, ?)',
      )
      .run(migration.version, 1_000, migration.name, migration.checksum);
    return;
  }
  const table = kind === 'catalog' ? 'catalog_schema_migrations' : 'history_schema_migrations';
  database
    .prepare(`INSERT INTO ${table}(version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`) 
    .run(migration.version, migration.name, 1_000, migration.checksum);
}

function assertMigrationLedger(databasePath: string, suite: MigrationSuite): void {
  const database = new Database(databasePath, { readonly: true });
  try {
    const count = database
      .prepare<[], CountRow>(`SELECT COUNT(*) AS count FROM ${suite.ledgerTable}`)
      .get()?.count;
    expect(count).toBe(suite.migrations().length);
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    database.close();
  }
}
