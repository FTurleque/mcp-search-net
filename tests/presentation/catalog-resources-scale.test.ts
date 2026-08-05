import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import type { CatalogRepository } from '../../src/application/ports/catalog-repository.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { registerCatalogResources } from '../../src/presentation/mcp/catalog-resources.js';

describe('catalog resource scalable access', () => {
  it('never uses unbounded collection ports for summaries, pages or id lookups', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-resource-scale-'));
    const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), {
      now: () => new Date(1_000),
    });
    const source = await catalog.addSource({
      sourceKey: 'scale-source',
      displayName: 'Scale source',
      baseUrl: 'https://scale.example.test/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const revision = await catalog.commitDocumentRevision({
      document: {
        publicId: 'scale-document',
        sourceId: source.id,
        canonicalUrl: 'https://scale.example.test/document',
        stableKey: 'document',
        title: 'Scale document',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'scale-version',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          content: 'Bounded section content',
          contentHash: 'scale-section',
          characterCount: 23,
        },
      ],
    });

    const repository = rejectUnboundedReads(catalog);
    const server = new McpServer({ name: 'catalog-resource-scale-test', version: '1.0.0' });
    registerCatalogResources(server, repository);
    const client = new Client({ name: 'catalog-resource-scale-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const uris = [
        'mcp-search-net://catalog',
        'mcp-search-net://sources',
        'mcp-search-net://sources/page/0',
        `mcp-search-net://sources/${source.id}`,
        'mcp-search-net://documents',
        'mcp-search-net://documents/page/0',
        `mcp-search-net://documents/${revision.document.id}`,
        `mcp-search-net://documents/${revision.document.id}/versions`,
        `mcp-search-net://documents/${revision.document.id}/versions/page/0`,
        `mcp-search-net://documents/${revision.document.id}/versions/${revision.version.id}`,
        'mcp-search-net://sections',
        'mcp-search-net://sections/page/0',
        `mcp-search-net://sections/${revision.sections[0]?.id}`,
      ];
      for (const uri of uris) {
        const resource = await client.readResource({ uri });
        expect(resource.contents[0]).toMatchObject({ uri, mimeType: 'application/json' });
      }
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      catalog.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function rejectUnboundedReads(catalog: SqliteCatalogRepository): CatalogRepository {
  const blocked = new Set<PropertyKey>([
    'listSources',
    'listDocuments',
    'listCurrentDocumentSections',
    'listDocumentVersions',
  ]);
  return new Proxy(catalog, {
    get(target, property, receiver) {
      if (blocked.has(property)) {
        return () => Promise.reject(new Error(`UNBOUNDED_PORT_USED:${String(property)}`));
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => Reflect.apply(value, target, args) as unknown;
    },
  });
}
