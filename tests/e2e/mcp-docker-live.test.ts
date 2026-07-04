import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const live = process.env['RUN_LIVE_SERVICES'] === '1';

const expectedToolNames = ['fetch_url', 'search_docs', 'search_web'];

describe.runIf(live)('containerized MCP STDIO server', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('starts through docker compose and exposes V1 tools plus V2 catalog search', async () => {
    client = new Client({ name: 'mcp-search-net-docker-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'docker',
      args: ['compose', 'run', '--rm', '-T', 'mcp-search-net'],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });

    await client.connect(transport);
    const response = await client.listTools();
    expect(response.tools.map((tool) => tool.name).sort()).toEqual(expectedToolNames);
  });
});
