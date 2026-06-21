import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

describe('MCP STDIO server', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('advertises exactly the two V1 tools', async () => {
    client = new Client({ name: 'mcp-search-net-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/bootstrap/main.js')],
      env: {
        MCP_SEARCH_CONFIG: resolve('config/application.yml'),
        CRAWL4AI_API_TOKEN: 'mcp-search-local-development-token',
      },
      stderr: 'pipe',
    });

    await client.connect(transport);
    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name).sort()).toEqual(['fetch_url', 'search_web']);
    for (const tool of response.tools) {
      expect(tool.inputSchema).toHaveProperty('properties');
      expect(tool.outputSchema).toMatchObject({ type: 'object' });
    }
  });
});
