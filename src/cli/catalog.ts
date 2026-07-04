import { resolve } from 'node:path';
import process from 'node:process';

import { SqliteCatalogRepository } from '../infrastructure/catalog/sqlite-catalog-repository.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';

interface CatalogCommandOptions {
  readonly command: 'init' | 'status';
  readonly path: string;
}

interface CatalogStatusOutput {
  readonly schemaVersion: '1.0';
  readonly status: 'ready';
  readonly path: string;
  readonly sourceCount: number;
  readonly documentCount: number;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArguments(argv);
  const repository = new SqliteCatalogRepository(options.path, new SystemClock());
  try {
    const [sources, documents] = await Promise.all([
      repository.listSources(),
      repository.listDocuments(),
    ]);
    const output: CatalogStatusOutput = {
      schemaVersion: '1.0',
      status: 'ready',
      path: options.path,
      sourceCount: sources.length,
      documentCount: documents.length,
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    repository.close();
  }
}

function parseArguments(argv: readonly string[]): CatalogCommandOptions {
  const command = argv[0];
  if (command !== 'init' && command !== 'status') throw new Error(usage());

  const pathFlagIndex = argv.indexOf('--path');
  const path = pathFlagIndex === -1 ? defaultCatalogPath() : argv[pathFlagIndex + 1];
  if (path === undefined || path === '') throw new Error(usage());

  return { command, path: resolve(path) };
}

function defaultCatalogPath(): string {
  return resolve(process.env['MCP_CATALOG_PATH'] ?? '.data/catalog.db');
}

function usage(): string {
  return 'Usage: catalog <init|status> [--path <catalog.db>]';
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
