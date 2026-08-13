import { resolve } from 'node:path';
import process from 'node:process';

import {
  MaintainCatalog,
  type CatalogMaintenanceInput,
} from '../application/use-cases/maintain-catalog.js';
import { SqliteCatalogMaintenance } from '../infrastructure/catalog/sqlite-catalog-maintenance.js';
import { StructuredLogger, type LogLevel } from '../infrastructure/logging/structured-logger.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { assertStrictCliArguments } from './strict-cli-arguments.js';
import { parseStrictInteger } from './strict-integer.js';

const DEFAULT_KEEP_SYNC_RUNS = 100;
const DEFAULT_MAX_SYNC_RUN_AGE_DAYS = 90;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1_000;

const CATALOG_MAINTAIN_ARGUMENTS = {
  valueOptions: ['--path', '--keep-sync-runs', '--max-sync-run-age-days', '--stale-lock-ms'],
  flags: ['--vacuum'],
} as const;

interface CatalogMaintainOptions extends CatalogMaintenanceInput {
  readonly path: string;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArguments(argv);
  const clock = new SystemClock();
  const logger = new StructuredLogger(parseLogLevel(process.env['MCP_LOG_LEVEL']));
  const runner = new SqliteCatalogMaintenance(options.path, clock, logger);
  const result = await new MaintainCatalog(runner).execute(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(argv: readonly string[]): CatalogMaintainOptions {
  if (argv.includes('--help') || argv.includes('-h')) throw new Error(usage());
  assertStrictCliArguments(argv, CATALOG_MAINTAIN_ARGUMENTS);
  return {
    path: resolve(
      getOption(argv, '--path') ?? process.env['MCP_CATALOG_PATH'] ?? '.data/catalog.db',
    ),
    keepSyncRuns:
      parseNonNegativeInteger(getOption(argv, '--keep-sync-runs'), '--keep-sync-runs') ??
      DEFAULT_KEEP_SYNC_RUNS,
    maxSyncRunAgeDays:
      parseNonNegativeInteger(
        getOption(argv, '--max-sync-run-age-days'),
        '--max-sync-run-age-days',
      ) ?? DEFAULT_MAX_SYNC_RUN_AGE_DAYS,
    vacuum: argv.includes('--vacuum'),
    staleLockMs:
      parsePositiveInteger(getOption(argv, '--stale-lock-ms'), '--stale-lock-ms') ??
      DEFAULT_STALE_LOCK_MS,
  };
}

function getOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value === '') throw new Error(`Missing value for ${name}`);
  return value;
}

function parseNonNegativeInteger(
  value: string | undefined,
  optionName: string,
): number | undefined {
  return parseStrictInteger(value, optionName, 0);
}

function parsePositiveInteger(value: string | undefined, optionName: string): number | undefined {
  return parseStrictInteger(value, optionName, 1);
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warning' || value === 'error') {
    return value;
  }
  return 'info';
}

function usage(): string {
  return [
    'Usage:',
    '  catalog-maintain [--path <catalog.db>] [--keep-sync-runs <n>]',
    '  [--max-sync-run-age-days <days>] [--stale-lock-ms <ms>] [--vacuum]',
  ].join('\n');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
