import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const live = process.env['RUN_LIVE_CRAWL4AI'] === '1';

describe.runIf(live)('live MCP fetch', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('fetches a public page through the complete STDIO stack', async () => {
    client = new Client({ name: 'mcp-search-net-live-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        MCP_CRAWL4AI_TOKEN: 'mcp-search-local-development-token',
      },
      stderr: 'pipe',
    });

    await client.connect(transport);
    const blocked = await client.callTool({
      name: 'fetch_url',
      arguments: { url: 'http://127.0.0.1/private' },
    });
    expect(blocked.isError).toBe(true);
    expect(blocked._meta?.['mcp-search-net/error']).toMatchObject({
      code: 'BLOCKED_ADDRESS',
      retryable: false,
    });

    const result = await client.callTool({
      name: 'fetch_url',
      arguments: {
        url: 'https://example.com',
        query: 'documentation examples',
        maxCharacters: 4_000,
        maxSections: 5,
        renderMode: 'static',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      data: {
        title: 'Example Domain',
        finalUrl: 'https://example.com/',
        sectionCount: expect.any(Number),
      },
    });
  });
});
