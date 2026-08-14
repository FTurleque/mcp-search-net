import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createContainer } from '../../src/bootstrap/container.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

const REQUEST_ID_1 = '00000000-0000-4000-8000-000000000101';
const REQUEST_ID_2 = '00000000-0000-4000-8000-000000000102';

describe('list_search_history MCP contract', () => {
  it('lists persisted entries with filters and keyset pagination', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-history-tool-'));
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const container = createContainer({
      ...loaded,
      catalogPath: join(root, 'catalog.db'),
      application: {
        ...loaded.application,
        cache: { ...loaded.application.cache, path: join(root, 'cache.sqlite') },
        history: { ...loaded.application.history, path: join(root, 'history.sqlite') },
      },
    });
    const client = new Client({ name: 'search-history-tool-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await container.history.append({
        requestId: REQUEST_ID_1,
        tool: 'search_web',
        query: 'Sonar coverage',
        request: { language: 'fr-FR', maxResults: 5 },
        durationMs: 12.5,
        status: 'success',
        cacheStatus: 'MISS',
        provider: 'searxng',
        resultCount: 5,
        warningCodes: [],
      });
      await container.history.append({
        requestId: REQUEST_ID_2,
        tool: 'search_web',
        query: 'Sonar quality gate',
        request: { language: 'fr-FR', maxResults: 3 },
        durationMs: 7.5,
        status: 'success',
        cacheStatus: 'MISS',
        provider: 'searxng',
        resultCount: 3,
        warningCodes: [],
      });

      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const first = await client.callTool({
        name: 'list_search_history',
        arguments: {
          tool: 'search_web',
          status: 'success',
          cacheStatus: 'MISS',
          from: '2000-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',
          queryContains: 'Sonar',
          limit: 1,
        },
      });
      expect(first.isError).not.toBe(true);
      expect(first.structuredContent).toMatchObject({
        status: 'success',
        warnings: [],
        metadata: {
          cacheStatus: 'DISABLED',
          provider: 'history',
        },
        data: {
          enabled: true,
          available: true,
          count: 1,
          total: 2,
        },
      });
      const firstData = first.structuredContent as {
        readonly data: {
          readonly nextBeforeId: number | null;
          readonly searches: readonly { readonly requestId: string; readonly query: string }[];
        };
      };
      expect(firstData.data.nextBeforeId).toEqual(expect.any(Number));
      expect(firstData.data.searches[0]).toMatchObject({
        requestId: REQUEST_ID_2,
        query: 'Sonar quality gate',
      });
      expect(first.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Sonar quality gate'),
        }),
      ]);

      const second = await client.callTool({
        name: 'list_search_history',
        arguments: {
          tool: 'search_web',
          queryContains: 'Sonar',
          limit: 1,
          beforeId: firstData.data.nextBeforeId ?? undefined,
        },
      });
      expect(second.structuredContent).toMatchObject({
        status: 'success',
        data: {
          count: 1,
          searches: [{ requestId: REQUEST_ID_1, query: 'Sonar coverage' }],
        },
      });
    } finally {
      await client.close().catch(() => undefined);
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      container.history.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports NO_RESULTS for an empty available history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-history-empty-'));
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const container = createContainer({
      ...loaded,
      catalogPath: join(root, 'catalog.db'),
      application: {
        ...loaded.application,
        cache: { ...loaded.application.cache, path: join(root, 'cache.sqlite') },
        history: { ...loaded.application.history, path: join(root, 'history.sqlite') },
      },
    });
    const client = new Client({ name: 'search-history-empty-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: 'list_search_history', arguments: {} });

      expect(result.structuredContent).toMatchObject({
        status: 'success',
        warnings: [{ code: 'NO_RESULTS' }],
        data: { enabled: true, available: true, count: 0, total: 0 },
      });
    } finally {
      await client.close().catch(() => undefined);
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      container.history.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports HISTORY_DISABLED without failing the tool call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-history-disabled-'));
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const container = createContainer({
      ...loaded,
      catalogPath: join(root, 'catalog.db'),
      application: {
        ...loaded.application,
        cache: { ...loaded.application.cache, path: join(root, 'cache.sqlite') },
        history: {
          ...loaded.application.history,
          enabled: false,
          path: join(root, 'history.sqlite'),
        },
      },
    });
    const client = new Client({ name: 'search-history-disabled-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await expect(
        container.history.append({
          requestId: REQUEST_ID_1,
          tool: 'search_docs',
          query: 'disabled history',
          request: {},
          durationMs: 1,
          status: 'success',
          provider: 'catalog',
          resultCount: 0,
          warningCodes: [],
        }),
      ).resolves.toBe(false);

      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: 'list_search_history', arguments: {} });

      expect(result.structuredContent).toMatchObject({
        status: 'success',
        warnings: [{ code: 'HISTORY_DISABLED' }],
        data: { enabled: false, available: true, count: 0, total: 0 },
      });
    } finally {
      await client.close().catch(() => undefined);
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      container.history.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports HISTORY_UNAVAILABLE while keeping the MCP server usable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-history-unavailable-'));
    const blockedParent = join(root, 'blocked-parent');
    writeFileSync(blockedParent, 'not-a-directory', 'utf8');
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const container = createContainer({
      ...loaded,
      catalogPath: join(root, 'catalog.db'),
      application: {
        ...loaded.application,
        cache: { ...loaded.application.cache, path: join(root, 'cache.sqlite') },
        history: {
          ...loaded.application.history,
          path: join(blockedParent, 'history.sqlite'),
        },
      },
    });
    const client = new Client({ name: 'search-history-unavailable-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await expect(
        container.history.append({
          requestId: REQUEST_ID_1,
          tool: 'search_docs',
          query: 'unavailable history',
          request: {},
          durationMs: 1,
          status: 'failed',
          provider: 'catalog',
          warningCodes: [],
          errorCode: 'INTERNAL_ERROR',
        }),
      ).resolves.toBe(false);

      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: 'list_search_history', arguments: {} });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: 'partial',
        warnings: [{ code: 'HISTORY_UNAVAILABLE' }],
        data: { enabled: true, available: false, count: 0, total: 0 },
      });
    } finally {
      await client.close().catch(() => undefined);
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      container.history.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
