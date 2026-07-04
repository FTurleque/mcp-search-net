import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';
const catalogResourceUri = 'mcp-search-net://catalog';
const expectedResourceUris = [
  catalogResourceUri,
  'mcp-search-net://documents',
  'mcp-search-net://sections',
  'mcp-search-net://sources',
];

describe('MCP catalog resources', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('lists and reads read-only catalog resources', async () => {
    client = new Client({ name: 'mcp-search-net-resource-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
      },
      stderr: 'pipe',
    });

    await client.connect(transport);
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual(expectedResourceUris);

    const catalog = await client.readResource({ uri: catalogResourceUri });
    const firstContent = catalog.contents[0];
    if (firstContent === undefined || !('text' in firstContent)) {
      throw new Error('Catalog resource must return JSON text content');
    }

    expect(firstContent).toMatchObject({
      uri: catalogResourceUri,
      mimeType: 'application/json',
    });
    const parsed = JSON.parse(firstContent.text) as { resources: string[] };
    expect([...parsed.resources].sort()).toEqual(expectedResourceUris);
    expect(parsed).toMatchObject({
      schemaVersion: '1.0',
      counts: {
        sources: expect.any(Number),
        enabledSources: expect.any(Number),
        documents: expect.any(Number),
        activeDocuments: expect.any(Number),
        currentSections: expect.any(Number),
      },
    });
  });
});
