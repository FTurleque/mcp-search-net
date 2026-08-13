import { resolve } from 'node:path';
import type { Readable } from 'node:stream';

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
    client = new Client({ name: 'mcp-search-net-live-test', version: '1.1.2' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        MCP_CRAWL4AI_TOKEN: requireCrawl4aiToken(),
      },
      stderr: 'pipe',
    });
    let stderr = '';
    captureStderr(transport, (chunk) => {
      stderr += chunk;
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
    await waitUntil(
      () =>
        stderr.includes('"event":"url_blocked"') &&
        stderr.includes('"code":"BLOCKED_ADDRESS"') &&
        stderr.includes('"event":"tool_call_completed"'),
    );
    const stderrRecords = parseStderrRecords(stderr);
    expect(stderrRecords).toContainEqual(
      expect.objectContaining({
        event: 'url_blocked',
        tool: 'fetch_url',
        code: 'BLOCKED_ADDRESS',
      }),
    );
    expect(stderrRecords).toContainEqual(
      expect.objectContaining({
        event: 'tool_call_completed',
        tool: 'fetch_url',
      }),
    );
  });
});

function requireCrawl4aiToken(): string {
  const token = process.env['CRAWL4AI_API_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('CRAWL4AI_API_TOKEN is required for live MCP tests');
  }
  return token;
}

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
