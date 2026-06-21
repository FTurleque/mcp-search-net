import { FetchUrl } from '../application/use-cases/fetch-url.js';
import { SearchWeb } from '../application/use-cases/search-web.js';
import { SqliteCacheRepository } from '../infrastructure/cache/sqlite-cache-repository.js';
import type { LoadedConfiguration } from '../infrastructure/config/load-configuration.js';
import { Crawl4aiContentFetcher } from '../infrastructure/fetch/crawl4ai-content-fetcher.js';
import { StructuredLogger } from '../infrastructure/logging/structured-logger.js';
import { PublicUrlSecurityPolicy } from '../infrastructure/security/public-url-security-policy.js';
import { SearxngSearchProvider } from '../infrastructure/search/searxng-search-provider.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { createMcpServer } from '../presentation/mcp/mcp-server.js';

export function createContainer(loaded: LoadedConfiguration) {
  const config = loaded.application;
  const logger = new StructuredLogger(config.logging.level);
  const clock = new SystemClock();
  const cache = new SqliteCacheRepository(config.cache.path, clock, config.cache.maxEntries);
  const securityPolicy = new PublicUrlSecurityPolicy(config.security);
  const searchProvider = new SearxngSearchProvider(
    config.searxng.baseUrl,
    config.searxng.timeoutMs,
  );
  const contentFetcher = new Crawl4aiContentFetcher(
    config.crawl4ai.baseUrl,
    config.crawl4ai.timeoutMs,
    loaded.crawl4aiApiToken,
  );
  const searchWeb = new SearchWeb(searchProvider, cache, loaded.officialSources, {
    cacheTtlMs: config.cache.searchTtlMs,
    providerOversampling: config.limits.providerOversampling,
    maxSnippetChars: config.limits.maxSnippetChars,
  });
  const fetchUrl = new FetchUrl(contentFetcher, cache, securityPolicy, clock, {
    cacheTtlMs: config.cache.fetchTtlMs,
    maxLinks: config.limits.maxLinks,
  });
  const mcpServer = createMcpServer({ searchWeb, fetchUrl, config, logger });

  return { cache, logger, mcpServer } as const;
}
