import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import type { OfficialSourceRegistry } from '../../application/ports/official-source-registry.js';
import {
  applicationConfigSchema,
  applicationEnvironmentSchema,
  officialSourcesFileSchema,
} from './application-config.js';
import type { ApplicationConfig, ApplicationEnvironment } from './application-config.js';
import { loadYaml } from './yaml-loader.js';
import { OfficialSourceYamlRegistry } from './official-source-yaml-registry.js';
import { ConfigurationError } from '../../domain/errors/domain-errors.js';

const KNOWN_DEVELOPMENT_TOKEN_HASHES = new Set([
  '2c996270398ba9479c876ad40555684a7638564acc76103d2b1322e40103ea23',
  '28e149e2458d26cc3ac7bd52bf257b26107df159cfe3cca78d14d2e0917079d4',
  '13403f17ba8f70ff7ec2e214abb8c948e9d9a69dac59b218fb60be6c5304effb',
]);

export interface LoadedConfiguration {
  readonly application: ApplicationConfig;
  readonly catalogPath: string;
  readonly officialSources: OfficialSourceRegistry;
  readonly crawl4aiApiToken?: string;
}

export async function loadConfiguration(configPath: string): Promise<LoadedConfiguration> {
  const absoluteConfigPath = resolve(configPath);
  const environment = applicationEnvironmentSchema.parse(process.env);
  const yamlApplication = await loadYaml(absoluteConfigPath, applicationConfigSchema);
  const application = applicationConfigSchema.parse(
    applyEnvironmentOverrides(yamlApplication, environment),
  );
  const configurationDirectory = dirname(absoluteConfigPath);
  const cachePath = resolve(configurationDirectory, application.cache.path);
  const catalogPath =
    environment.MCP_CATALOG_PATH === undefined
      ? resolve(dirname(cachePath), 'catalog.db')
      : resolve(configurationDirectory, environment.MCP_CATALOG_PATH);
  assertDistinctDatabasePaths(cachePath, catalogPath);
  const officialPath = resolve(
    configurationDirectory,
    environment.MCP_OFFICIAL_SOURCES_PATH ??
      firstEnvironment('MCP_SEARCH_OFFICIAL_SOURCES_PATH') ??
      application.officialSourcesPath,
  );
  const officialFile = await loadYaml(officialPath, officialSourcesFileSchema);
  const tokenFromEnvironment =
    application.crawl4ai.apiTokenEnvironmentVariable === undefined
      ? undefined
      : process.env[application.crawl4ai.apiTokenEnvironmentVariable];
  const crawl4aiApiToken =
    environment.MCP_CRAWL4AI_TOKEN ??
    firstEnvironment('CRAWL4AI_API_TOKEN') ??
    tokenFromEnvironment ??
    application.crawl4ai.apiToken;
  assertSafeSecretProfile(application.application.profile, crawl4aiApiToken);

  return {
    application: {
      ...application,
      cache: {
        ...application.cache,
        path: cachePath,
      },
      officialSourcesPath: officialPath,
    },
    catalogPath,
    officialSources: new OfficialSourceYamlRegistry(officialFile),
    ...(crawl4aiApiToken === undefined ? {} : { crawl4aiApiToken }),
  };
}

interface ExistingFileIdentity {
  readonly realPath: string;
  readonly device: bigint;
  readonly inode: bigint;
}

export function assertDistinctDatabasePaths(cachePath: string, catalogPath: string): void {
  const normalizeForComparison = (path: string): string =>
    process.platform === 'win32' ? path.toLowerCase() : path;
  const canonicalCachePath = canonicalizePotentialPath(cachePath);
  const canonicalCatalogPath = canonicalizePotentialPath(catalogPath);
  if (
    normalizeForComparison(cachePath) === normalizeForComparison(catalogPath) ||
    normalizeForComparison(canonicalCachePath) === normalizeForComparison(canonicalCatalogPath)
  ) {
    throw new ConfigurationError('Cache and catalog paths must be different');
  }

  const cacheIdentity = existingFileIdentity(cachePath);
  const catalogIdentity = existingFileIdentity(catalogPath);
  if (cacheIdentity === undefined || catalogIdentity === undefined) return;

  if (
    normalizeForComparison(cacheIdentity.realPath) ===
      normalizeForComparison(catalogIdentity.realPath) ||
    (cacheIdentity.inode !== 0n &&
      catalogIdentity.inode !== 0n &&
      cacheIdentity.device === catalogIdentity.device &&
      cacheIdentity.inode === catalogIdentity.inode)
  ) {
    throw new ConfigurationError('Cache and catalog paths must be different');
  }
}

function canonicalizePotentialPath(path: string): string {
  let existingAncestor = resolve(path);
  const missingSegments: string[] = [];

  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return resolve(path);
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }

  const canonicalAncestor = realpathSync.native(existingAncestor);
  return resolve(canonicalAncestor, ...missingSegments);
}

function existingFileIdentity(path: string): ExistingFileIdentity | undefined {
  if (!existsSync(path)) return undefined;
  const realPath = realpathSync.native(path);
  const statistics = statSync(realPath, { bigint: true });
  return {
    realPath,
    device: statistics.dev,
    inode: statistics.ino,
  };
}

function applyEnvironmentOverrides(
  application: ApplicationConfig,
  environment: ApplicationEnvironment,
): unknown {
  const searxngUrl = environment.MCP_SEARXNG_URL ?? firstEnvironment('MCP_SEARCH_SEARXNG_URL');
  const crawl4aiUrl = environment.MCP_CRAWL4AI_URL ?? firstEnvironment('MCP_SEARCH_CRAWL4AI_URL');
  const cachePath = environment.MCP_CACHE_PATH ?? firstEnvironment('MCP_SEARCH_CACHE_PATH');
  const logLevel = environment.MCP_LOG_LEVEL ?? firstEnvironment('MCP_SEARCH_LOG_LEVEL');
  const cacheEnabled = environmentBoolean('MCP_SEARCH_CACHE_ENABLED');
  const continueOnError = environmentBoolean('MCP_SEARCH_CACHE_CONTINUE_ON_ERROR');
  return {
    ...application,
    application: {
      ...application.application,
      ...(environment.MCP_PROFILE === undefined ? {} : { profile: environment.MCP_PROFILE }),
    },
    searxng: {
      ...application.searxng,
      ...(searxngUrl === undefined ? {} : { baseUrl: searxngUrl }),
    },
    crawl4ai: {
      ...application.crawl4ai,
      ...(crawl4aiUrl === undefined ? {} : { baseUrl: crawl4aiUrl }),
    },
    cache: {
      ...application.cache,
      ...(cachePath === undefined ? {} : { path: cachePath }),
      ...(cacheEnabled === undefined ? {} : { enabled: cacheEnabled }),
      ...(continueOnError === undefined ? {} : { continueOnError }),
    },
    logging: {
      ...application.logging,
      ...(logLevel === undefined ? {} : { level: logLevel }),
    },
    security: {
      ...application.security,
      ...(environment.MCP_ALLOWED_PUBLIC_PORTS === undefined
        ? {}
        : { allowedPorts: environment.MCP_ALLOWED_PUBLIC_PORTS }),
    },
  };
}

function assertSafeSecretProfile(
  profile: ApplicationConfig['application']['profile'],
  token: string | undefined,
): void {
  if (profile === 'development' || token === undefined) return;
  if (KNOWN_DEVELOPMENT_TOKEN_HASHES.has(hashSecret(token))) {
    throw new ConfigurationError(
      `A known development Crawl4AI token is forbidden in the ${profile} profile`,
    );
  }
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function firstEnvironment(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function environmentBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  throw new Error(`Environment variable ${name} must be a boolean`);
}
