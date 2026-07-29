import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';
const catalogResourceUri = 'mcp-search-net://catalog';
const expectedResourceUris = [
  catalogResourceUri,
  'mcp-search-net://documents',
  'mcp-search-net://sections',
  'mcp-search-net://sources',
];
const expectedResourceTemplateUris = [
  'mcp-search-net://documents/{documentId}',
  'mcp-search-net://documents/page/{offset}',
  'mcp-search-net://documents/{documentId}/versions',
  'mcp-search-net://documents/{documentId}/versions/page/{offset}',
  'mcp-search-net://documents/{documentId}/versions/{versionId}',
  'mcp-search-net://sections/{sectionId}',
  'mcp-search-net://sections/page/{offset}',
  'mcp-search-net://sources/{sourceId}',
  'mcp-search-net://sources/page/{offset}',
];

describe('MCP catalog resources', () => {
  let client: Client | undefined;
  let cacheRoot: string | undefined;

  afterEach(async () => {
    await client?.close();
    if (cacheRoot !== undefined) rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('lists and reads read-only catalog resources and templates', async () => {
    client = new Client({ name: 'mcp-search-net-resource-test', version: '1.0.0' });
    cacheRoot = mkdtempSync(join(tmpdir(), 'mcp-search-resources-'));
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
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual(
      expectedResourceUris,
    );

    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((resource) => resource.uriTemplate).sort()).toEqual(
      [...expectedResourceTemplateUris].sort(),
    );

    const catalog = await client.readResource({ uri: catalogResourceUri });
    const firstContent = catalog.contents[0];
    if (firstContent === undefined || !('text' in firstContent)) {
      throw new Error('Catalog resource must return JSON text content');
    }

    expect(firstContent).toMatchObject({
      uri: catalogResourceUri,
      mimeType: 'application/json',
    });
    const parsed = JSON.parse(firstContent.text) as { resources: string[] };
    expect([...parsed.resources].sort()).toEqual(
      [...expectedResourceUris, ...expectedResourceTemplateUris].sort(),
    );
    expect(parsed).toMatchObject({
      schemaVersion: '1.0',
      counts: {
        sources: expect.any(Number),
        enabledSources: expect.any(Number),
        documents: expect.any(Number),
        activeDocuments: expect.any(Number),
        currentSections: expect.any(Number),
      },
    });

    const missingSource = await readJsonResource<{
      found: boolean;
      source: { id: number } | null;
    }>(client, 'mcp-search-net://sources/999999');
    expect(missingSource).toEqual({
      schemaVersion: '1.0',
      sourceId: 999999,
      found: false,
      source: null,
    });

    const missingVersions = await readJsonResource<{
      documentId: number;
      available: boolean;
      bounded: boolean;
      count: number;
      total: number;
      offset: number;
      limit: number;
      nextOffset: number | null;
      nextUri: string | null;
      versions: unknown[];
    }>(client, 'mcp-search-net://documents/999999/versions');
    expect(missingVersions).toMatchObject({
      schemaVersion: '1.0',
      documentId: 999999,
      available: true,
      bounded: true,
      count: 0,
      total: 0,
      offset: 0,
      limit: 20,
      nextOffset: null,
      nextUri: null,
      versions: [],
    });

    for (const uri of [
      'mcp-search-net://sources/page/0',
      'mcp-search-net://documents/page/0',
      'mcp-search-net://sections/page/0',
    ]) {
      await expect(readJsonResource(client, uri)).resolves.toMatchObject({
        schemaVersion: '1.0',
        bounded: true,
        offset: 0,
        limit: 20,
      });
    }
  });
});

async function readJsonResource<T>(client: Client, uri: string): Promise<T> {
  const resource = await client.readResource({ uri });
  const content = resource.contents[0];
  if (content === undefined || !('text' in content)) {
    throw new Error(`Resource ${uri} must return JSON text content`);
  }
  return JSON.parse(content.text) as T;
}
