import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const live = process.env['RUN_LIVE_SEARXNG'] === '1';

describe.runIf(live)('live MCP search', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('searches through the complete STDIO stack and returns the common envelope', async () => {
    client = new Client({ name: 'mcp-search-net-live-search-test', version: '1.0.0' });
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
    const result = await client.callTool({
      name: 'search_web',
      arguments: {
        query: 'model context protocol',
        sourcePolicy: 'strict',
        allowedDomains: ['modelcontextprotocol.io'],
        maxResults: 5,
      },
    });

    if (result.isError === true) {
      throw new Error(`Live search failed: ${JSON.stringify(result)}`);
    }
    expect(result.structuredContent).toMatchObject({
      schemaVersion: '1.0',
      metadata: {
        tool: 'search_web',
        provider: 'searxng',
      },
      data: {
        query: 'model context protocol',
      },
    });
    const structured = result.structuredContent as {
      requestId: string;
      metadata: { cacheStatus: string };
      data: { results: { url: string; sourceStatus: string; score: number }[] };
    };
    expect(structured.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(['HIT', 'MISS']).toContain(structured.metadata.cacheStatus);
    expect(structured.data.results.length).toBeGreaterThan(0);
    expect(structured.data.results[0]?.url).toMatch(/^https?:\/\//u);
    expect(structured.data.results.every((item) => item.sourceStatus === 'VERIFIED_OFFICIAL')).toBe(
      true,
    );
    expect(structured.data.results[0]?.score).toBeGreaterThanOrEqual(0);
    expect(structured.data.results[0]?.score).toBeLessThanOrEqual(1);
  });
});
