import { resolve } from 'node:path';
import process from 'node:process';

import { HybridSearchCatalogDocuments } from '../application/use-cases/hybrid-search-catalog-documents.js';
import { SqliteCatalogRepository } from '../infrastructure/catalog/sqlite-catalog-repository.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';

interface CatalogHybridSearchOptions {
  readonly path: string;
  readonly query: string;
  readonly sourceKey?: string;
  readonly language?: string;
  readonly limit?: number;
  readonly candidateLimit?: number;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArguments(argv);
  const repository = new SqliteCatalogRepository(options.path, new SystemClock());
  try {
    const result = await new HybridSearchCatalogDocuments(repository).execute(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    repository.close();
  }
}

function parseArguments(argv: readonly string[]): CatalogHybridSearchOptions {
  if (argv.includes('--help') || argv.includes('-h')) throw new Error(usage());
  const sourceKey = getOption(argv, '--source-key');
  const language = getOption(argv, '--language');
  const limit = parsePositiveInteger(getOption(argv, '--limit'), '--limit');
  const candidateLimit = parsePositiveInteger(getOption(argv, '--candidate-limit'), '--candidate-limit');
  return {
    path: resolve(getOption(argv, '--path') ?? process.env['MCP_CATALOG_PATH'] ?? '.data/catalog.db'),
    query: requireOption(argv, '--query'),
    ...(sourceKey === undefined ? {} : { sourceKey }),
    ...(language === undefined ? {} : { language }),
    ...(limit === undefined ? {} : { limit }),
    ...(candidateLimit === undefined ? {} : { candidateLimit }),
  };
}

function getOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value === '') throw new Error(`Missing value for ${name}`);
  return value;
}

function requireOption(argv: readonly string[], name: string): string {
  const value = getOption(argv, name);
  if (value === undefined) throw new Error(`Missing required option ${name}\n${usage()}`);
  return value;
}

function parsePositiveInteger(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${optionName} ${value}`);
  return parsed;
}

function usage(): string {
  return [
    'Usage:',
    '  catalog-hybrid-search --query <text> [--path <catalog.db>] [--source-key <key>] [--language <language>] [--limit <n>] [--candidate-limit <n>]',
  ].join('\n');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
