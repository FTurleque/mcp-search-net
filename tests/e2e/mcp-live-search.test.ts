import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const live = process.env['RUN_LIVE_SEARXNG'] === '1';

describe.runIf(live)('live MCP search', () => {
  let client: Client | undefined;
  let cacheRoot: string | undefined;

  afterEach(async () => {
    await client?.close();
    if (cacheRoot !== undefined) rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('searches through the complete STDIO stack and returns the common envelope', async () => {
    client = new Client({ name: 'mcp-search-net-live-search-test', version: '1.0.0' });
    cacheRoot = mkdtempSync(join(tmpdir(), 'mcp-search-live-cache-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        MCP_CRAWL4AI_TOKEN: 'mcp-search-local-development-token',
        MCP_CACHE_PATH: join(cacheRoot, 'cache.sqlite'),
      },
      stderr: 'pipe',
    });
    let stderr = '';
    captureStderr(transport, (chunk) => {
      stderr += chunk;
    });

    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['fetch_url', 'search_web']);

    const result = await client.callTool({
      name: 'search_web',
      arguments: {
        query: 'model context protocol',
        sourcePolicy: 'any',
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
    expect(structured.metadata.cacheStatus).toBe('MISS');
    expect(structured.data.results.length).toBeGreaterThan(0);
    expect(structured.data.results[0]?.url).toMatch(/^https?:\/\//u);
    expect(structured.data.results[0]?.sourceStatus).toMatch(
      /^(VERIFIED_OFFICIAL|LIKELY_OFFICIAL|THIRD_PARTY|UNKNOWN)$/u,
    );
    expect(structured.data.results[0]?.score).toBeGreaterThanOrEqual(0);
    expect(structured.data.results[0]?.score).toBeLessThanOrEqual(1);

    const cachedResult = await client.callTool({
      name: 'search_web',
      arguments: {
        query: 'model context protocol',
        sourcePolicy: 'any',
        maxResults: 5,
      },
    });
    expect(cachedResult.structuredContent).toMatchObject({
      metadata: { cacheStatus: 'HIT' },
    });
    await waitUntil(() => stderr.includes('"cacheStatus":"HIT"'));
    const stderrRecords = parseStderrRecords(stderr);
    expect(stderrRecords).toContainEqual(
      expect.objectContaining({
        event: 'tool_call_completed',
        tool: 'search_web',
        cacheStatus: 'MISS',
      }),
    );
    expect(stderrRecords).toContainEqual(
      expect.objectContaining({
        event: 'tool_call_completed',
        tool: 'search_web',
        cacheStatus: 'HIT',
      }),
    );
  });
});

function captureStderr(transport: StdioClientTransport, onChunk: (chunk: string) => void): void {
  const stderr = transport.stderr as Readable | null;
  stderr?.setEncoding('utf8');
  stderr?.on('data', (chunk: string | Buffer) => {
    onChunk(chunk.toString());
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for MCP stderr output');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

function parseStderrRecords(stderr: string): Record<string, unknown>[] {
  return stderr
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
