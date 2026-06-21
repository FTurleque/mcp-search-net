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
  const application = await loadYaml(absoluteConfigPath, applicationConfigSchema);
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
