import { resolve } from 'node:path';
import process from 'node:process';

import { LoadCatalogSources } from '../application/use-cases/load-catalog-sources.js';
import { PlanCatalogSync } from '../application/use-cases/plan-catalog-sync.js';
import { PurgeCatalogVersions } from '../application/use-cases/purge-catalog-versions.js';
import { RebuildCatalogIndex } from '../application/use-cases/rebuild-catalog-index.js';
import { SearchCatalogDocuments } from '../application/use-cases/search-catalog-documents.js';
import {
  SyncCatalogDocuments,
  type SyncCatalogResumeCursor,
} from '../application/use-cases/sync-catalog-documents.js';
import { VerifyCatalog } from '../application/use-cases/verify-catalog.js';
import type {
  CatalogFreshnessPolicy,
  CatalogSourceType,
  CatalogSyncStrategy,
  NewCatalogSource,
} from '../domain/models/catalog.js';
import { SqliteCatalogBackup } from '../infrastructure/catalog/sqlite-catalog-backup.js';
import { SqliteCatalogRepository } from '../infrastructure/catalog/sqlite-catalog-repository.js';
import { SqliteCatalogVersionPurger } from '../infrastructure/catalog/sqlite-catalog-version-purger.js';
import { loadConfiguration } from '../infrastructure/config/load-configuration.js';
import { Crawl4aiContentFetcher } from '../infrastructure/fetch/crawl4ai-content-fetcher.js';
import { SecureHttpGateway } from '../infrastructure/fetch/secure-http-gateway.js';
import { StructuredLogger } from '../infrastructure/logging/structured-logger.js';
import { PublicUrlSecurityPolicy } from '../infrastructure/security/public-url-security-policy.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { loadCatalogSourceConfig } from './catalog-source-config.js';
import { ingestTextDocument } from './catalog-ingest-text.js';
import { parseStrictInteger } from './strict-integer.js';

const SOURCE_TYPES = ['documentation', 'reference', 'api', 'guide'] as const;
const FRESHNESS_POLICIES = ['manual', 'daily', 'weekly', 'monthly'] as const;
const SYNC_STRATEGIES = ['manual', 'polling'] as const;

const DEFAULT_KEEP_PREVIOUS_VERSIONS = 3;

type CatalogCommand =
  | 'init'
  | 'status'
  | 'health'
  | 'backup'
  | 'list-sources'
  | 'load-sources'
  | 'sync'
  | 'add-source'
  | 'ingest-text'
  | 'search'
  | 'verify'
  | 'rebuild-index'
  | 'purge-versions';

interface CatalogCommandOptions {
  readonly command: CatalogCommand;
  readonly path: string;
  readonly backup?: {
    readonly destinationPath: string;
  };
  readonly source?: NewCatalogSource;
  readonly sourceConfig?: {
    readonly filePath: string;
  };
  readonly sync?: {
    readonly dryRun: boolean;
    readonly sourceKey?: string;
    readonly filePath?: string;
    readonly configPath: string;
    readonly limit?: number;
    readonly rateLimitMs?: number;
    readonly resumeAfter?: SyncCatalogResumeCursor;
  };
  readonly text?: {
    readonly sourceKey: string;
    readonly filePath: string;
    readonly canonicalUrl: string;
    readonly title: string;
    readonly language: string;
    readonly mimeType: string;
    readonly stableKey?: string;
    readonly versionLabel?: string;
  };
  readonly search?: {
    readonly query: string;
    readonly sourceKey?: string;
    readonly language?: string;
    readonly limit?: number;
  };
  readonly purge?: {
    readonly dryRun: boolean;
    readonly sourceKey?: string;
    readonly keepPreviousVersions: number;
  };
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
  const clock = new SystemClock();

  if (options.command === 'backup') {
    if (options.backup === undefined) throw new Error(usage());
    const result = await new SqliteCatalogBackup(options.path, clock).run(
      options.backup.destinationPath,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (options.command === 'purge-versions') {
    if (options.purge === undefined) throw new Error(usage());
    const purger = new SqliteCatalogVersionPurger(options.path, clock);
    try {
      const result = await new PurgeCatalogVersions(purger).execute(options.purge);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    } finally {
      purger.close();
    }
  }

  const repository = new SqliteCatalogRepository(options.path, clock);
  try {
    if (options.command === 'load-sources') {
      if (options.sourceConfig === undefined) throw new Error(usage());
      const config = await loadCatalogSourceConfig(options.sourceConfig.filePath);
      const result = await new LoadCatalogSources(repository).execute(config);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (options.command === 'sync') {
      if (options.sync === undefined) throw new Error(usage());
      if (options.sync.filePath === undefined) {
        throw new Error('catalog sync requires --file <catalog-sources.yml>');
      }
      const catalogConfig = await loadCatalogSourceConfig(options.sync.filePath);
      if (options.sync.dryRun) {
        const result = await new PlanCatalogSync(repository, clock).execute({
          ...(options.sync.sourceKey === undefined ? {} : { sourceKey: options.sync.sourceKey }),
          documents: catalogConfig.documents,
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const loaded = await loadConfiguration(options.sync.configPath);
      const appConfig = loaded.application;
      const logger = new StructuredLogger(appConfig.logging.level);
      const securityPolicy = new PublicUrlSecurityPolicy(appConfig.security, undefined, logger);
      const gateway = new SecureHttpGateway(securityPolicy, {
        timeoutMs: appConfig.crawl4ai.timeoutMs,
        maxBytes: appConfig.security.maxDownloadBytes,
        maxRedirects: appConfig.security.maxRedirects,
        maxConcurrency: appConfig.security.maxConcurrency,
        minimumDelayMs: appConfig.security.minimumDelayMs,
        respectRobotsTxt: appConfig.security.respectRobotsTxt,
        userAgent: `${appConfig.application.name}/${appConfig.application.version}`,
      });
      const fetcher = new Crawl4aiContentFetcher(
        appConfig.crawl4ai.baseUrl,
        loaded.crawl4aiApiToken,
        gateway,
      );
      const result = await new SyncCatalogDocuments(repository, fetcher, clock).execute({
        ...(options.sync.sourceKey === undefined ? {} : { sourceKey: options.sync.sourceKey }),
        documents: catalogConfig.documents,
        ...(options.sync.limit === undefined ? {} : { limit: options.sync.limit }),
        timeoutMs: appConfig.crawl4ai.timeoutMs,
        maxResponseBytes: appConfig.security.maxDownloadBytes,
        maxRedirects: appConfig.security.maxRedirects,
        rateLimitMs: options.sync.rateLimitMs ?? appConfig.security.minimumDelayMs,
        ...(options.sync.resumeAfter === undefined
          ? {}
          : { resumeAfter: options.sync.resumeAfter }),
      });
      const verification = await new VerifyCatalog(repository).execute();
      if (verification.status === 'FAILED') {
        throw new Error('CATALOG_VERIFY_FAILED_AFTER_SYNC');
      }
      const index = { indexedSections: verification.counts.indexedSections };
      process.stdout.write(`${JSON.stringify({ ...result, index }, null, 2)}\n`);
      return;
    }

    if (options.command === 'add-source') {
      if (options.source === undefined) throw new Error(usage());
      const source = await repository.addSource(options.source);
      process.stdout.write(`${JSON.stringify({ schemaVersion: '1.0', source }, null, 2)}\n`);
      return;
    }

    if (options.command === 'ingest-text') {
      if (options.text === undefined) throw new Error(usage());
      const result = await ingestTextDocument(repository, options.text);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (options.command === 'search') {
      if (options.search === undefined) throw new Error(usage());
      const result = await new SearchCatalogDocuments(repository).execute(options.search);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (options.command === 'verify') {
      const result = await new VerifyCatalog(repository).execute();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status === 'FAILED') process.exitCode = 1;
      return;
    }

    if (options.command === 'health') {
      const [verification, sourceCount, documentCount] = await Promise.all([
        new VerifyCatalog(repository).execute(),
        repository.countSources(),
        repository.countDocuments(),
      ]);
      const status = verification.status === 'OK' ? 'healthy' : 'degraded';
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: '1.0',
            status,
            path: options.path,
            sourceCount,
            documentCount,
            verification,
          },
          null,
          2,
        )}\n`,
      );
      if (status === 'degraded') process.exitCode = 1;
      return;
    }

    if (options.command === 'rebuild-index') {
      const result = await new RebuildCatalogIndex(repository).execute();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (options.command === 'list-sources') {
      const sources = await repository.listSources();
      process.stdout.write(`${JSON.stringify({ schemaVersion: '1.0', sources }, null, 2)}\n`);
      return;
    }

    const [sourceCount, documentCount] = await Promise.all([
      repository.countSources(),
      repository.countDocuments(),
    ]);
    const output: CatalogStatusOutput = {
      schemaVersion: '1.0',
      status: 'ready',
      path: options.path,
      sourceCount,
      documentCount,
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    repository.close();
  }
}

function parseArguments(argv: readonly string[]): CatalogCommandOptions {
  const command = parseCommand(argv[0]);
  const path = getOption(argv, '--path') ?? defaultCatalogPath();
  if (command === 'load-sources') return parseLoadSources(argv, path);
  if (command === 'sync') return parseSync(argv, path);
  if (command === 'add-source') return parseAddSource(argv, path);
  if (command === 'ingest-text') return parseIngestText(argv, path);
  if (command === 'search') return parseSearch(argv, path);
  if (command === 'purge-versions') return parsePurgeVersions(argv, path);
  if (command === 'backup') {
    return {
      command,
      path: resolve(path),
      backup: { destinationPath: resolve(requireOption(argv, '--output')) },
    };
  }
  return { command, path: resolve(path) };
}

function parseCommand(value: string | undefined): CatalogCommand {
  if (
    value === 'init' ||
    value === 'status' ||
    value === 'health' ||
    value === 'backup' ||
    value === 'list-sources' ||
    value === 'load-sources' ||
    value === 'sync' ||
    value === 'add-source' ||
    value === 'ingest-text' ||
    value === 'search' ||
    value === 'verify' ||
    value === 'rebuild-index' ||
    value === 'purge-versions'
  ) {
    return value;
  }
  throw new Error(usage());
}

function parseLoadSources(argv: readonly string[], path: string): CatalogCommandOptions {
  return {
    command: 'load-sources',
    path: resolve(path),
    sourceConfig: {
      filePath: resolve(getOption(argv, '--file') ?? 'config/catalog-sources.yml'),
    },
  };
}

function parseSync(argv: readonly string[], path: string): CatalogCommandOptions {
  const sourceKey = getOption(argv, '--source-key') ?? getOption(argv, '--source');
  const filePath = getOption(argv, '--file');
  const limit = parseLimit(getOption(argv, '--limit'));
  const rateLimitMs = parseNonNegativeInteger(
    getOption(argv, '--rate-limit-ms'),
    '--rate-limit-ms',
  );
  const resumeAfter = parseResumeAfter(getOption(argv, '--resume-after'), sourceKey);
  return {
    command: 'sync',
    path: resolve(path),
    sync: {
      dryRun: argv.includes('--dry-run'),
      configPath: resolve(getOption(argv, '--config') ?? 'config/application.yml'),
      ...(limit === undefined ? {} : { limit }),
      ...(rateLimitMs === undefined ? {} : { rateLimitMs }),
      ...(sourceKey === undefined ? {} : { sourceKey }),
      ...(filePath === undefined ? {} : { filePath: resolve(filePath) }),
      ...(resumeAfter === undefined ? {} : { resumeAfter }),
    },
  };
}

function parseAddSource(argv: readonly string[], path: string): CatalogCommandOptions {
  return {
    command: 'add-source',
    path: resolve(path),
    source: {
      sourceKey: requireOption(argv, '--key'),
      displayName: requireOption(argv, '--name'),
      baseUrl: requireOption(argv, '--base-url'),
      sourceType: parseSourceType(getOption(argv, '--type') ?? 'documentation'),
      language: getOption(argv, '--language') ?? 'fr',
      freshnessPolicy: parseFreshnessPolicy(getOption(argv, '--freshness') ?? 'manual'),
      syncStrategy: parseSyncStrategy(getOption(argv, '--sync') ?? 'manual'),
      enabled: !argv.includes('--disabled'),
    },
  };
}

function parseIngestText(argv: readonly string[], path: string): CatalogCommandOptions {
  const stableKey = getOption(argv, '--stable-key');
  const versionLabel = getOption(argv, '--version-label');
  return {
    command: 'ingest-text',
    path: resolve(path),
    text: {
      sourceKey: requireOption(argv, '--source-key'),
      filePath: resolve(requireOption(argv, '--file')),
      canonicalUrl: requireOption(argv, '--url'),
      title: requireOption(argv, '--title'),
      language: getOption(argv, '--language') ?? 'fr',
      mimeType: getOption(argv, '--mime-type') ?? 'text/markdown',
      ...(stableKey === undefined ? {} : { stableKey }),
      ...(versionLabel === undefined ? {} : { versionLabel }),
    },
  };
}

function parseSearch(argv: readonly string[], path: string): CatalogCommandOptions {
  const sourceKey = getOption(argv, '--source-key');
  const language = getOption(argv, '--language');
  const limit = parseLimit(getOption(argv, '--limit'));
  return {
    command: 'search',
    path: resolve(path),
    search: {
      query: requireOption(argv, '--query'),
      ...(sourceKey === undefined ? {} : { sourceKey }),
      ...(language === undefined ? {} : { language }),
      ...(limit === undefined ? {} : { limit }),
    },
  };
}

function parsePurgeVersions(argv: readonly string[], path: string): CatalogCommandOptions {
  const sourceKey = getOption(argv, '--source-key') ?? getOption(argv, '--source');
  const keepPreviousVersions =
    parseKeepPreviousVersions(getOption(argv, '--keep') ?? getOption(argv, '--keep-previous')) ??
    DEFAULT_KEEP_PREVIOUS_VERSIONS;
  return {
    command: 'purge-versions',
    path: resolve(path),
    purge: {
      dryRun: argv.includes('--dry-run'),
      keepPreviousVersions,
      ...(sourceKey === undefined ? {} : { sourceKey }),
    },
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

function parseLimit(value: string | undefined): number | undefined {
  return parseStrictInteger(value, 'limit', 1);
}

function parseKeepPreviousVersions(value: string | undefined): number | undefined {
  return parseStrictInteger(value, 'keep', 0);
}

function parseNonNegativeInteger(
  value: string | undefined,
  optionName: string,
): number | undefined {
  return parseStrictInteger(value, optionName, 0);
}

function parseResumeAfter(
  value: string | undefined,
  scopedSourceKey: string | undefined,
): SyncCatalogResumeCursor | undefined {
  if (value === undefined) return undefined;
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) {
    if (scopedSourceKey === undefined) {
      throw new Error('--resume-after without --source-key must use <sourceKey>:<stableKey>');
    }
    return { sourceKey: scopedSourceKey, stableKey: value };
  }

  const sourceKey = value.slice(0, separatorIndex);
  const stableKey = value.slice(separatorIndex + 1);
  if (sourceKey.length === 0 || stableKey.length === 0) {
    throw new Error('--resume-after must use <sourceKey>:<stableKey>');
  }
  return { sourceKey, stableKey };
}

function parseSourceType(value: string): CatalogSourceType {
  if (SOURCE_TYPES.includes(value as CatalogSourceType)) return value as CatalogSourceType;
  throw new Error(`Invalid source type ${value}`);
}

function parseFreshnessPolicy(value: string): CatalogFreshnessPolicy {
  if (FRESHNESS_POLICIES.includes(value as CatalogFreshnessPolicy)) {
    return value as CatalogFreshnessPolicy;
  }
  throw new Error(`Invalid freshness policy ${value}`);
}

function parseSyncStrategy(value: string): CatalogSyncStrategy {
  if (SYNC_STRATEGIES.includes(value as CatalogSyncStrategy)) return value as CatalogSyncStrategy;
  throw new Error(`Invalid sync strategy ${value}`);
}

function defaultCatalogPath(): string {
  return resolve(process.env['MCP_CATALOG_PATH'] ?? '.data/catalog.db');
}

function usage(): string {
  return [
    'Usage:',
    '  catalog init [--path <catalog.db>]',
    '  catalog status [--path <catalog.db>]',
    '  catalog health [--path <catalog.db>]',
    '  catalog backup [--path <catalog.db>] --output <snapshot.db>',
    '  catalog verify [--path <catalog.db>]',
    '  catalog rebuild-index [--path <catalog.db>]',
    '  catalog purge-versions [--path <catalog.db>] [--source-key <key>] [--keep <previous-version-count>] [--dry-run]',
    '  catalog list-sources [--path <catalog.db>]',
    '  catalog load-sources [--path <catalog.db>] [--file <catalog-sources.yml>]',
    '  catalog sync --dry-run [--path <catalog.db>] --file <catalog-sources.yml> [--source-key <key>]',
    '  catalog sync [--path <catalog.db>] --file <catalog-sources.yml> [--config <application.yml>] [--source-key <key>] [--limit <n>] [--rate-limit-ms <ms>] [--resume-after <sourceKey:stableKey|stableKey>]',
    '  catalog add-source --key <key> --name <name> --base-url <url> [--path <catalog.db>] [--type documentation|reference|api|guide] [--language <language>] [--freshness manual|daily|weekly|monthly] [--sync manual|polling] [--disabled]',
    '  catalog ingest-text --source-key <key> --file <file> --url <url> --title <title> [--path <catalog.db>] [--language <language>] [--mime-type <mime>] [--stable-key <key>] [--version-label <label>]',
    '  catalog search --query <text> [--path <catalog.db>] [--source-key <key>] [--language <language>] [--limit <n>]',
  ].join('\n');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
