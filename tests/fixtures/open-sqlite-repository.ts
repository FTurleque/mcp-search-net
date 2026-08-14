import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { SqliteSearchHistoryRepository } from '../../src/infrastructure/history/sqlite-search-history-repository.js';

const [kind, databasePath, readyPath, goPath] = process.argv.slice(2);
if (
  kind === undefined ||
  databasePath === undefined ||
  readyPath === undefined ||
  goPath === undefined
) {
  throw new Error('Usage: open-sqlite-repository <cache|catalog|history> <db> <ready> <go>');
}

writeFileSync(readyPath, `${process.pid}\n`, 'utf8');
while (!existsSync(goPath)) await delay(5);

const clock = { now: () => new Date() };

switch (kind) {
  case 'cache': {
    const repository = new SqliteCacheRepository(
      databasePath,
      clock,
      2_000,
      268_435_456,
      604_800_000,
    );
    repository.close();
    break;
  }
  case 'catalog': {
    const repository = new SqliteCatalogRepository(databasePath, clock);
    repository.close();
    break;
  }
  case 'history': {
    const repository = new SqliteSearchHistoryRepository(databasePath, clock, 90, 20_000);
    repository.close();
    break;
  }
  default:
    throw new Error(`Unknown repository kind: ${kind}`);
}
