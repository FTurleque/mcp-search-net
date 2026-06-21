import { dirname, resolve } from 'node:path';

import type { OfficialSourceRegistry } from '../../application/ports/official-source-registry.js';
import { applicationConfigSchema, officialSourcesFileSchema } from './application-config.js';
import type { ApplicationConfig } from './application-config.js';
import { loadYaml } from './yaml-loader.js';
import { OfficialSourceYamlRegistry } from './official-source-yaml-registry.js';

export interface LoadedConfiguration {
  readonly application: ApplicationConfig;
  readonly officialSources: OfficialSourceRegistry;
  readonly crawl4aiApiToken?: string;
}

export async function loadConfiguration(configPath: string): Promise<LoadedConfiguration> {
  const absoluteConfigPath = resolve(configPath);
  const yamlApplication = await loadYaml(absoluteConfigPath, applicationConfigSchema);
  const application = applicationConfigSchema.parse(applyEnvironmentOverrides(yamlApplication));
  const officialPath = resolve(dirname(absoluteConfigPath), application.officialSourcesPath);
  const officialFile = await loadYaml(officialPath, officialSourcesFileSchema);
  const tokenFromEnvironment =
    application.crawl4ai.apiTokenEnvironmentVariable === undefined
      ? undefined
      : process.env[application.crawl4ai.apiTokenEnvironmentVariable];
  const crawl4aiApiToken = tokenFromEnvironment ?? application.crawl4ai.apiToken;

  return {
    application: {
      ...application,
      cache: {
        ...application.cache,
        path: resolve(dirname(absoluteConfigPath), application.cache.path),
      },
      officialSourcesPath: officialPath,
    },
    officialSources: new OfficialSourceYamlRegistry(officialFile),
    ...(crawl4aiApiToken === undefined ? {} : { crawl4aiApiToken }),
  };
}

function applyEnvironmentOverrides(application: ApplicationConfig): unknown {
  const searxngUrl = process.env['MCP_SEARCH_SEARXNG_URL'];
  const crawl4aiUrl = process.env['MCP_SEARCH_CRAWL4AI_URL'];
  const cachePath = process.env['MCP_SEARCH_CACHE_PATH'];
  const logLevel = process.env['MCP_SEARCH_LOG_LEVEL'];
  const cacheEnabled = environmentBoolean('MCP_SEARCH_CACHE_ENABLED');
  const continueOnError = environmentBoolean('MCP_SEARCH_CACHE_CONTINUE_ON_ERROR');
  return {
    ...application,
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
  };
}

function environmentBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return value as unknown as boolean;
}
