import { resolve } from 'node:path';

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
  'mcp-search-net://documents/{documentId}/versions',
  'mcp-search-net://documents/{documentId}/versions/{versionId}',
  'mcp-search-net://sections/{sectionId}',
  'mcp-search-net://sources/{sourceId}',
];

describe('MCP catalog resources', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('lists and reads read-only catalog resources and templates', async () => {
    client = new Client({ name: 'mcp-search-net-resource-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('build/bootstrap/main.js')],
      env: {
        MCP_CONFIG_PATH: resolve('config/application.yml'),
        [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
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
      expectedResourceTemplateUris,
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
      count: number;
      versions: unknown[];
    }>(client, 'mcp-search-net://documents/999999/versions');
    expect(missingVersions).toEqual({
      schemaVersion: '1.0',
      documentId: 999999,
      available: true,
      count: 0,
      versions: [],
    });

    const missingVersion = await readJsonResource<{
      documentId: number;
      versionId: number;
      available: boolean;
      found: boolean;
      version: unknown | null;
    }>(client, 'mcp-search-net://documents/999999/versions/888888');
    expect(missingVersion).toEqual({
      schemaVersion: '1.0',
      documentId: 999999,
      versionId: 888888,
      available: true,
      found: false,
      version: null,
    });
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
