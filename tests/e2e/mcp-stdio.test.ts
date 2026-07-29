import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';

describe('MCP STDIO server', () => {
  let client: Client | undefined;
  let cacheRoot: string | undefined;

  afterEach(async () => {
    await client?.close();
    if (cacheRoot !== undefined) rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('advertises V1 tools and compact V2 catalog tools', async () => {
    client = new Client({ name: 'mcp-search-net-test', version: '1.0.0' });
    cacheRoot = mkdtempSync(join(tmpdir(), 'mcp-search-stdio-'));
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
    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name).sort()).toEqual([
      'fetch_url',
      'list_docs',
      'read_doc_section',
      'search_docs',
      'search_web',
    ]);

    const searchDocsTool = response.tools.find((tool) => tool.name === 'search_docs');
    expect(searchDocsTool?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string', maxLength: 500 },
        sourceKey: { type: 'string', maxLength: 128 },
        maxResults: { default: 5, maximum: 10 },
        maxSnippetChars: { default: 240, maximum: 500 },
        compact: { default: false },
      },
    });

    const listDocsTool = response.tools.find((tool) => tool.name === 'list_docs');
    expect(listDocsTool?.inputSchema).toMatchObject({
      properties: {
        language: { type: 'string', maxLength: 32 },
        status: {
          enum: ['ACTIVE', 'STALE', 'REDIRECTED', 'REMOVED', 'UNAVAILABLE'],
        },
        limit: { default: 20, maximum: 50 },
        offset: { default: 0 },
      },
    });

    const readSectionTool = response.tools.find((tool) => tool.name === 'read_doc_section');
    expect(readSectionTool?.inputSchema).toMatchObject({
      properties: {
        sectionId: { type: 'integer' },
        maxCharacters: { default: 3000, maximum: 8000 },
      },
    });

    const catalogSearch = await client.callTool({
      name: 'search_docs',
      arguments: { query: 'definitely-no-matching-catalog-section', compact: true },
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

    const compactList = await client.callTool({ name: 'list_docs', arguments: { limit: 3 } });
    expect(compactList.isError).not.toBe(true);
    expect(compactList.structuredContent).toMatchObject({
      schemaVersion: '1.0',
      status: 'success',
      metadata: { tool: 'list_docs', cacheStatus: 'DISABLED', provider: 'catalog' },
      data: {
        count: expect.any(Number),
        total: expect.any(Number),
        nextOffset: null,
        truncated: false,
        documents: expect.any(Array),
      },
    });

    const missingSection = await client.callTool({
      name: 'read_doc_section',
      arguments: { sectionId: 999999, maxCharacters: 500 },
    });
    expect(missingSection.isError).not.toBe(true);
    expect(missingSection.structuredContent).toMatchObject({
      schemaVersion: '1.0',
      status: 'success',
      metadata: { tool: 'read_doc_section', cacheStatus: 'DISABLED', provider: 'catalog' },
      data: {
        sectionId: 999999,
        found: false,
        content: '',
      },
      warnings: [
        {
          code: 'NO_RESULTS',
        },
      ],
    });
  });

  it('keeps stdout as JSON-RPC and writes structured diagnostics only to stderr', async () => {
    const privateValue = 'test-value-that-must-not-leak';
    cacheRoot = mkdtempSync(join(tmpdir(), 'mcp-search-stdio-output-'));
    const child = spawn(process.execPath, [resolve('build/bootstrap/main.js')], {
      env: {
        ...process.env,
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        [crawl4aiEnvironmentName]: privateValue,
        MCP_CACHE_PATH: join(cacheRoot, 'cache.sqlite'),
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
