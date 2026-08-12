import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const live = process.env['RUN_LIVE_SERVICES'] === '1';

const expectedToolNames = [
  'fetch_url',
  'list_docs',
  'read_doc_section',
  'search_docs',
  'search_web',
];

describe.runIf(live)('containerized MCP STDIO server', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('starts through docker compose and exposes the complete read-only tool contract', async () => {
    client = new Client({ name: 'mcp-search-net-docker-test', version: '1.1.2' });
    const transport = new StdioClientTransport({
      command: 'docker',
      args: ['compose', 'run', '--rm', '-T', 'mcp-search-net'],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });

    await client.connect(transport);
    const response = await client.listTools();
    expect(response.tools.map((tool) => tool.name).sort()).toEqual(expectedToolNames);

    const listed = await client.callTool({ name: 'list_docs', arguments: { limit: 1 } });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({ schemaVersion: '1.0' });

    const resources = await client.listResources();
    expect(resources.resources.map(({ uri }) => uri).sort()).toEqual([
      'mcp-search-net://catalog',
      'mcp-search-net://documents',
      'mcp-search-net://sections',
      'mcp-search-net://sources',
    ]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates).toHaveLength(9);
    const catalog = await client.readResource({ uri: 'mcp-search-net://catalog' });
    expect(catalog.contents[0]).toMatchObject({
      uri: 'mcp-search-net://catalog',
      mimeType: 'application/json',
    });
  });
});
