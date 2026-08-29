import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { DisabledCacheRepository } from '../../src/application/ports/cache-repository.js';
import { FetchUrl } from '../../src/application/use-cases/fetch-url.js';
import { ListSearchHistory } from '../../src/application/use-cases/list-search-history.js';
import { SearchWeb } from '../../src/application/use-cases/search-web.js';
import { TrackedSearchCatalogDocuments } from '../../src/application/use-cases/tracked-search-catalog-documents.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { SafeSearchHistoryRepository } from '../../src/infrastructure/history/safe-search-history-repository.js';
import { SqliteSearchHistoryRepository } from '../../src/infrastructure/history/sqlite-search-history-repository.js';
import { StructuredLogger } from '../../src/infrastructure/logging/structured-logger.js';
import { SystemClock } from '../../src/infrastructure/time/system-clock.js';
import { createMcpServer } from '../../src/presentation/mcp/mcp-server.js';

const roots: string[] = [];

describe('web tools (search_web, fetch_url) through the real MCP server', () => {
  it('registers and executes search_web and fetch_url end to end', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-web-tools-'));
    roots.push(root);
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const clock = new SystemClock();
    const logger = new StructuredLogger('error');
    const catalogRepository = new SqliteCatalogRepository(join(root, 'catalog.db'), clock);
    const history = new SafeSearchHistoryRepository(
      new SqliteSearchHistoryRepository(join(root, 'history.sqlite'), clock, 30, 1_000),
      logger,
    );

    const searchWeb = new SearchWeb(
      {
        async search() {
          return {
            results: [
              {
                title: 'Example result',
                url: 'https://example.test/docs',
                snippet: 'A snippet mentioning mcp-search-net.',
                score: 1,
                engines: ['fake'],
                updatedAt: '2026-06-22T00:00:00.000Z',
              },
            ],
            total: 1,
            unresponsiveEngines: [],
          };
        },
      },
      new DisabledCacheRepository(),
      loaded.officialSources,
      { cacheTtlMs: 1_000, providerOversampling: 3, maxSnippetChars: 500 },
    );

    const fetchUrl = new FetchUrl(
      {
        async fetch({ url }) {
          const value = url.value;
          return {
            requestedUrl: value,
            finalUrl: value,
            canonicalUrl: value,
            title: 'Example document',
            markdown: '# Example\n\nStatic fetched content for the test.',
            documentSections: [],
            contentType: 'text/html',
            fetchedAt: '2026-06-22T00:00:00.000Z',
            extractionMode: 'static' as const,
            statusCode: 200,
            contentHash: 'hash',
            redirectChain: [],
            metadata: { language: 'en' },
            links: [],
          };
        },
      },
      new DisabledCacheRepository(),
      {
        async assertAllowed(url: string) {
          return { value: url, hostname: 'example.test', addresses: ['93.184.216.34'] };
        },
      },
      loaded.officialSources,
      {
        documentationTtlMs: 1_000,
        readmeTtlMs: 1_000,
        sitemapTtlMs: 1_000,
        maxLinks: 10,
        timeoutMs: 1_000,
        maxResponseBytes: 1_000_000,
        maxRedirects: 5,
      },
    );

    const searchCatalogDocuments = new TrackedSearchCatalogDocuments(catalogRepository, history);
    const listSearchHistory = new ListSearchHistory(history, loaded.application.history.exposeTool);

    const server = createMcpServer({
      searchWeb,
      fetchUrl,
      catalogRepository,
      searchCatalogDocuments,
      listSearchHistory,
      config: loaded.application,
      logger,
    });

    const client = new Client({ name: 'mcp-search-net-web-tools-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const search = await client.callTool({
        name: 'search_web',
        arguments: { query: 'mcp-search-net' },
      });
      expect(search.isError).not.toBe(true);
      expect(search.structuredContent).toMatchObject({
        status: 'success',
        data: { results: [{ title: 'Example result', url: 'https://example.test/docs' }] },
      });
      const searchContent = search.content;
      if (!Array.isArray(searchContent)) throw new Error('Expected search_web text content');
      const searchText = searchContent[0];
      if (searchText === undefined || searchText.type !== 'text') {
        throw new Error('Expected a text block in search_web content');
      }
      expect(searchText.text).toContain('search_web success: 1 result(s)');
      expect(searchText.text).toContain('https://example.test/docs');

      const fetched = await client.callTool({
        name: 'fetch_url',
        arguments: { url: 'https://example.test/docs' },
      });
      expect(fetched.isError).not.toBe(true);
      expect(fetched.structuredContent).toMatchObject({
        status: 'partial',
        warnings: [{ code: 'UNVERIFIED_SOURCE' }],
        data: { finalUrl: 'https://example.test/docs' },
      });
      const fetchedContent = fetched.content;
      if (!Array.isArray(fetchedContent)) throw new Error('Expected fetch_url text content');
      const fetchedText = fetchedContent[0];
      if (fetchedText === undefined || fetchedText.type !== 'text') {
        throw new Error('Expected a text block in fetch_url content');
      }
      expect(fetchedText.text).toContain('Static fetched content for the test.');

      const invalidUrl = await client.callTool({
        name: 'fetch_url',
        arguments: { url: 'not-a-valid-url' },
      });
      expect(invalidUrl.isError).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      catalogRepository.close();
      history.close();
      roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
    }
  });
});
