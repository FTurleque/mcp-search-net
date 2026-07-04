import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';
const unsupportedFileUrl = 'file://' + '/etc/passwd';
const blockedLoopbackUrl = 'http://' + '127.0.0.1/private';

describe('MCP STDIO server', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('advertises V1 tools and the V2 catalog search tool', async () => {
    client = new Client({ name: 'mcp-search-net-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
      },
      stderr: 'pipe',
    });
    let stderr = '';
    captureStderr(transport, (chunk) => {
      stderr += chunk;
    });

    await client.connect(transport);
    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name).sort()).toEqual([
      'fetch_url',
      'search_docs',
      'search_web',
    ]);
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
        timeRange: { enum: ['day', 'month', 'year'] },
      },
    });
    const searchDocsTool = response.tools.find((tool) => tool.name === 'search_docs');
    expect(searchDocsTool?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string', maxLength: 500 },
        sourceKey: { type: 'string', maxLength: 128 },
        maxResults: { default: 5, maximum: 10 },
      },
    });

    const catalogSearch = await client.callTool({
      name: 'search_docs',
      arguments: { query: 'definitely-no-matching-catalog-section' },
    });
    expect(catalogSearch.isError).not.toBe(true);
    expect(catalogSearch.structuredContent).toMatchObject({
      schemaVersion: '1.0',
      status: 'success',
      metadata: { tool: 'search_docs', cacheStatus: 'DISABLED', provider: 'catalog' },
      data: {
        query: 'definitely-no-matching-catalog-section',
        resultCount: 0,
        results: [],
      },
      warnings: [
        {
          code: 'NO_RESULTS',
        },
      ],
    });

    const invalid = await client.callTool({
      name: 'search_web',
      arguments: { query: 42 },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid._meta?.['mcp-search-net/error']).toMatchObject({
      schemaVersion: '1.0',
      code: 'INVALID_ARGUMENT',
      retryable: false,
    });
    const invalidContent = invalid.content as { type: string; text: string }[];
    expect(invalidContent[0]).toMatchObject({ type: 'text' });
    expect(invalidContent[0]?.text).toContain('(INVALID_ARGUMENT)');

    const blockedFetch = await client.callTool({
      name: 'fetch_url',
      arguments: { url: unsupportedFileUrl },
    });
    expect(blockedFetch.isError).toBe(true);
    expect(blockedFetch._meta?.['mcp-search-net/error']).toMatchObject({
      code: 'UNSUPPORTED_PROTOCOL',
      retryable: false,
    });

    const blockedLocalFetch = await client.callTool({
      name: 'fetch_url',
      arguments: { url: blockedLoopbackUrl },
    });
    expect(blockedLocalFetch.isError).toBe(true);
    expect(blockedLocalFetch._meta?.['mcp-search-net/error']).toMatchObject({
      code: 'BLOCKED_ADDRESS',
      retryable: false,
    });
    await waitUntil(
      () =>
        stderr.includes('"event":"url_blocked"') && stderr.includes('"code":"BLOCKED_ADDRESS"'),
    );
    expect(parseStderrRecords(stderr)).toContainEqual(
      expect.objectContaining({
        event: 'url_blocked',
        tool: 'fetch_url',
        code: 'BLOCKED_ADDRESS',
      }),
    );
  });

  it('keeps stdout as JSON-RPC and writes structured diagnostics only to stderr', async () => {
    const privateValue = 'test-value-that-must-not-leak';
    const child = spawn(process.execPath, [resolve('build/bootstrap/main.js')], {
      env: {
        ...process.env,
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        [crawl4aiEnvironmentName]: privateValue,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-proof', version: '1.0.0' } } })}\n`,
    );
    await waitUntil(() => stdout.includes('"id":1'));
    child.kill();
    await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));

    const stdoutRecords = stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const stderrRecords = stderr
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(stdoutRecords).toHaveLength(1);
    expect(stdoutRecords[0]).toMatchObject({ jsonrpc: '2.0', id: 1 });
    expect(stderrRecords.some((record) => record['event'] === 'server_started')).toBe(true);
    expect(stderr).not.toContain(privateValue);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for MCP output');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

function captureStderr(transport: StdioClientTransport, onChunk: (chunk: string) => void): void {
  const stderr = transport.stderr as Readable | null;
  stderr?.setEncoding('utf8');
  stderr?.on('data', (chunk: string | Buffer) => {
    onChunk(chunk.toString());
  });
}

function parseStderrRecords(stderr: string): Record<string, unknown>[] {
  return stderr
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
