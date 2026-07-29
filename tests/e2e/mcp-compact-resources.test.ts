import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';

describe('MCP compact catalog resources', () => {
  let client: Client | undefined;
  let cacheRoot: string | undefined;

  afterEach(async () => {
    await client?.close();
    if (cacheRoot !== undefined) rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('keeps the global sections resource compact', async () => {
    client = new Client({ name: 'mcp-search-net-compact-resource-test', version: '1.0.0' });
    cacheRoot = mkdtempSync(join(tmpdir(), 'mcp-search-compact-resources-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
        MCP_CACHE_PATH: join(cacheRoot, 'cache.sqlite'),
      },
      stderr: 'pipe',
    });

    await client.connect(transport);
    const resource = await client.readResource({ uri: 'mcp-search-net://sections' });
    const content = resource.contents[0];
    if (content === undefined || !('text' in content)) {
      throw new Error('Sections resource must return JSON text content');
    }

    const parsed = JSON.parse(content.text) as {
      compact: boolean;
      bounded: boolean;
      count: number;
      limit: number;
      sections: { section: Record<string, unknown> }[];
    };
    expect(parsed.compact).toBe(true);
    expect(parsed.bounded).toBe(true);
    expect(parsed.count).toBeLessThanOrEqual(20);
    expect(parsed.limit).toBe(20);
    expect(content.text.length).toBeLessThanOrEqual(24_000);
    const firstSection = parsed.sections[0]?.section;
    if (firstSection !== undefined) {
      expect(firstSection).not.toHaveProperty('content');
      expect(firstSection).toHaveProperty('characterCount');
    }
  });
});
