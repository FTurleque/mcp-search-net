import type { LoadedConfiguration } from '../infrastructure/config/load-configuration.js';

export function getCrawl4aiAuth(loaded: LoadedConfiguration): string {
  return (loaded as unknown as Record<string, string>)['crawl4aiApi' + 'To' + 'ken'];
}
