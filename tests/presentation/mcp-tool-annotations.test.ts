import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createContainer } from '../../src/bootstrap/container.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

describe('MCP tool side-effect annotations', () => {
  it('marks persistent cache/history writers as non-read-only and keeps pure catalog/history reads read-only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-tool-annotations-'));
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
    const client = new Client({ name: 'mcp-tool-annotations-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

      for (const name of ['search_web', 'fetch_url', 'search_docs'] as const) {
        expect(byName.get(name)?.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        });
      }

      for (const name of ['list_docs', 'read_doc_section', 'list_search_history'] as const) {
        expect(byName.get(name)?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        });
      }
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
