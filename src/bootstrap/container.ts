import { FetchUrl } from '../application/use-cases/fetch-url.js';
import { ListSearchHistory } from '../application/use-cases/list-search-history.js';
import { TrackedSearchCatalogDocuments } from '../application/use-cases/tracked-search-catalog-documents.js';
import { TrackedSearchWeb } from '../application/use-cases/tracked-search-web.js';
import { DisabledCacheRepository } from '../application/ports/cache-repository.js';
import type { CacheRepository } from '../application/ports/cache-repository.js';
import type { CatalogRepository } from '../application/ports/catalog-repository.js';
import {
  DisabledSearchHistoryRepository,
  type SearchHistoryRepository,
  UnavailableSearchHistoryRepository,
} from '../application/ports/search-history-repository.js';
import { CacheUnavailableError } from '../domain/errors/domain-errors.js';
import { SafeCacheRepository } from '../infrastructure/cache/safe-cache-repository.js';
import { SqliteCacheRepository } from '../infrastructure/cache/sqlite-cache-repository.js';
import { SqliteCatalogRepository } from '../infrastructure/catalog/sqlite-catalog-repository.js';
import {
  assertDistinctDatabasePaths,
  type LoadedConfiguration,
} from '../infrastructure/config/load-configuration.js';
import { Crawl4aiContentFetcher } from '../infrastructure/fetch/crawl4ai-content-fetcher.js';
import { SecureHttpGateway } from '../infrastructure/fetch/secure-http-gateway.js';
import { SafeSearchHistoryRepository } from '../infrastructure/history/safe-search-history-repository.js';
import { SqliteSearchHistoryRepository } from '../infrastructure/history/sqlite-search-history-repository.js';
import { StructuredLogger } from '../infrastructure/logging/structured-logger.js';
import { PublicUrlSecurityPolicy } from '../infrastructure/security/public-url-security-policy.js';
import { SearxngSearchProvider } from '../infrastructure/search/searxng-search-provider.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { createMcpServer } from '../presentation/mcp/mcp-server-v2.js';

export function createContainer(loaded: LoadedConfiguration) {
  const config = loaded.application;
  const logger = new StructuredLogger(config.logging.level);
  const clock = new SystemClock();
  const cache = createCache(loaded, clock, logger);
  assertDistinctDatabasePaths(config.cache.path, loaded.catalogPath, config.history.path);
  const history = createHistory(loaded, clock, logger);
  const catalog = createCatalog(loaded, clock);
  const securityPolicy = new PublicUrlSecurityPolicy(config.security, undefined, logger);
  const secureGateway = new SecureHttpGateway(securityPolicy, {
    timeoutMs: config.crawl4ai.timeoutMs,
    maxBytes: config.security.maxDownloadBytes,
    maxRedirects: config.security.maxRedirects,
    maxConcurrency: config.security.maxConcurrency,
    minimumDelayMs: config.security.minimumDelayMs,
    respectRobotsTxt: config.security.respectRobotsTxt,
    userAgent: `${config.application.name}/${config.application.version}`,
  });
  const searchProvider = new SearxngSearchProvider(
    config.searxng.baseUrl,
    config.searxng.timeoutMs,
  );
  const contentFetcher = new Crawl4aiContentFetcher(
    config.crawl4ai.baseUrl,
    loaded.crawl4aiApiToken,
    secureGateway,
  );
  const searchWeb = new TrackedSearchWeb(
    searchProvider,
    cache,
    loaded.officialSources,
    {
      cacheTtlMs: config.cache.searchTtlMs,
      providerOversampling: config.limits.providerOversampling,
      maxSnippetChars: config.limits.maxSnippetChars,
      providerTimeoutMs: config.searxng.timeoutMs,
    },
    logger,
    history,
  );
  const fetchUrl = new FetchUrl(
    contentFetcher,
    cache,
    securityPolicy,
    loaded.officialSources,
    {
      documentationTtlMs: config.cache.documentationTtlMs,
      readmeTtlMs: config.cache.readmeTtlMs,
      sitemapTtlMs: config.cache.sitemapTtlMs,
      maxLinks: config.limits.maxLinks,
      timeoutMs: config.crawl4ai.timeoutMs,
      maxResponseBytes: config.security.maxDownloadBytes,
      maxRedirects: config.security.maxRedirects,
    },
    logger,
  );
  const searchCatalogDocuments = new TrackedSearchCatalogDocuments(catalog, history);
  const listSearchHistory = new ListSearchHistory(history);
  const mcpServer = createMcpServer({
    searchWeb,
    fetchUrl,
    catalogRepository: catalog,
    searchCatalogDocuments,
    listSearchHistory,
    config,
    logger,
  });

  return { cache, catalog, history, logger, mcpServer } as const;
}

function createCache(
  loaded: LoadedConfiguration,
  clock: SystemClock,
  logger: StructuredLogger,
): CacheRepository {
  const config = loaded.application.cache;
  if (!config.enabled) return new DisabledCacheRepository();
  try {
    return new SafeCacheRepository(
      new SqliteCacheRepository(
        config.path,
        clock,
        config.maxEntries,
        config.maxBytes,
        config.staleRetentionMs,
      ),
      config.continueOnError,
      logger,
    );
  } catch (error) {
    logger.error('cache_unavailable', {
      operation: 'open',
      error: error instanceof Error ? { name: error.name } : 'unknown',
    });
    if (!config.continueOnError)
      throw new CacheUnavailableError('The cache cannot be opened', { cause: error });
    return new DisabledCacheRepository();
  }
}

function createHistory(
  loaded: LoadedConfiguration,
  clock: SystemClock,
  logger: StructuredLogger,
): SearchHistoryRepository {
  const config = loaded.application.history;
  if (!config.enabled) return new DisabledSearchHistoryRepository();
  try {
    return new SafeSearchHistoryRepository(
      new SqliteSearchHistoryRepository(
        config.path,
        clock,
        config.retentionDays,
        config.maxEntries,
      ),
      logger,
    );
  } catch (error) {
    logger.error('history_unavailable', {
      operation: 'open',
      error: error instanceof Error ? { name: error.name } : 'unknown',
    });
    return new UnavailableSearchHistoryRepository();
  }
}

function createCatalog(loaded: LoadedConfiguration, clock: SystemClock): CatalogRepository {
  return new SqliteCatalogRepository(loaded.catalogPath, clock, { verifyIntegrityOnOpen: true });
}
