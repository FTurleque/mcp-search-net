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
      expect(tool.outputSchema).toMatchObject({
        type: 'object',
        properties: {
          schemaVersion: { const: '1.0' },
          requestId: { type: 'string' },
          data: { type: 'object' },
        },
      });
    }
    const searchTool = response.tools.find((tool) => tool.name === 'search_web');
    expect(searchTool?.inputSchema).toMatchObject({
      properties: {
        sourcePolicy: { default: 'prefer', enum: ['strict', 'prefer', 'any'] },
        allowedDomains: { type: 'array', maxItems: 20 },
        excludedDomains: { type: 'array', maxItems: 20 },
        language: { default: 'fr-FR' },
        timeRange: { enum: ['day', 'week', 'month', 'year'] },
      },
    });

    const invalid = await client.callTool({
      name: 'search_web',
      arguments: { query: 42 },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid._meta?.['mcp-search-net/error']).toMatchObject({
      schemaVersion: '1.0',
      error: { code: 'INVALID_ARGUMENT' },
      metadata: { tool: 'search_web' },
    });
    const invalidContent = invalid.content as { type: string; text: string }[];
    expect(invalidContent[0]).toMatchObject({ type: 'text' });
    expect(invalidContent[0]?.text).toContain('(INVALID_ARGUMENT)');
  });
});
