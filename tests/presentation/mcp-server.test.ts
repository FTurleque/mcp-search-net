import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createContainer } from '../../src/bootstrap/container.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

describe('MCP server in-memory contracts', () => {
  it('exposes compact catalog tools and resources through the real server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-search-in-memory-'));
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const container = createContainer({
      ...loaded,
      catalogPath: join(root, 'catalog.db'),
      application: {
        ...loaded.application,
        cache: { ...loaded.application.cache, path: join(root, 'cache.sqlite') },
        history: {
          ...loaded.application.history,
          path: join(root, 'history.sqlite'),
        },
      },
    });
    const client = new Client({ name: 'mcp-search-net-in-memory-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      const source = await container.catalog.addSource({
        sourceKey: 'sample',
        displayName: 'Sample',
        baseUrl: 'https://example.test/',
        sourceType: 'documentation',
        language: 'en',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      });
      const revision = await container.catalog.commitDocumentRevision({
        document: {
          publicId: 'sample-guide',
          sourceId: source.id,
          canonicalUrl: 'https://example.test/guide',
          stableKey: 'guide',
          title: 'Sample Guide',
          mimeType: 'text/markdown',
          language: 'en',
          status: 'ACTIVE',
        },
        version: {
          contentHash: 'sample-version',
          extractionMode: 'static',
          contentType: 'text/markdown',
          metadataJson: '{}',
        },
        sections: [
          {
            ordinal: 0,
            heading: 'Install',
            headingPath: 'Sample Guide > Install',
            content: 'Install the sample package with the documented command.',
            contentHash: 'sample-section',
            characterCount: 53,
          },
          {
            ordinal: 1,
            heading: 'Large appendix',
            headingPath: 'Sample Guide > Large appendix',
            content: 'x'.repeat(12_000),
            contentHash: 'sample-large-section',
            characterCount: 12_000,
          },
        ],
      });

      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name).sort()).toEqual([
        'fetch_url',
        'list_docs',
        'list_search_history',
        'read_doc_section',
        'search_docs',
        'search_web',
      ]);

      const search = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'sample package', compact: true },
      });
      expect(search.isError).not.toBe(true);
      expect(search.structuredContent).toMatchObject({
        status: 'success',
        data: { resultCount: 1, results: [{ documentPublicId: 'sample-guide' }] },
      });
      const searchData = search.structuredContent as {
        readonly data: { readonly results: readonly { readonly sectionId: number }[] };
      };
      const structuredSectionId = searchData.data.results[0]?.sectionId;
      expect(structuredSectionId).toBeGreaterThan(0);

      const searchContent = search.content;
      if (!Array.isArray(searchContent)) throw new Error('Expected search_docs text content');
      const searchText = searchContent[0];
      if (searchText === undefined || searchText.type !== 'text') {
        throw new Error('Expected a text block in search_docs content');
      }
      const sectionIdMatch = /sectionId=(\d+)/.exec(searchText.text);
      if (sectionIdMatch === null) {
        throw new Error('Expected the fallback text to expose sectionId');
      }
      const textSectionId = Number(sectionIdMatch[1]);
      expect(textSectionId).toBe(structuredSectionId);

      const chained = await client.callTool({
        name: 'read_doc_section',
        arguments: { sectionId: textSectionId },
      });
      expect(chained.structuredContent).toMatchObject({
        status: 'success',
        data: { found: true, sectionId: textSectionId },
      });

      const missingSection = await client.callTool({
        name: 'read_doc_section',
        arguments: { sectionId: 999_999_999 },
      });
      expect(missingSection.isError).not.toBe(true);
      expect(missingSection.structuredContent).toMatchObject({
        status: 'success',
        data: { found: false, sectionId: 999_999_999, document: null },
      });
      const missingSectionContent = missingSection.content;
      if (!Array.isArray(missingSectionContent)) {
        throw new Error('Expected read_doc_section text content');
      }
      const missingSectionText = missingSectionContent[0];
      if (missingSectionText === undefined || missingSectionText.type !== 'text') {
        throw new Error('Expected a text block in read_doc_section content');
      }
      expect(missingSectionText.text).toContain('no section found for 999999999');

      const emptySearch = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'zzz-no-catalog-document-matches-zzz' },
      });
      expect(emptySearch.isError).not.toBe(true);
      expect(emptySearch.structuredContent).toMatchObject({
        status: 'success',
        data: { resultCount: 0, results: [] },
        warnings: [{ code: 'NO_RESULTS' }],
      });

      const documents = await client.callTool({ name: 'list_docs', arguments: { limit: 1 } });
      expect(documents.structuredContent).toMatchObject({
        status: 'success',
        data: { count: 1, total: 1, documents: [{ publicId: 'sample-guide' }] },
      });

      const section = await client.callTool({
        name: 'read_doc_section',
        arguments: { sectionId: revision.sections[0]?.id, maxCharacters: 500 },
      });
      expect(section.structuredContent).toMatchObject({
        status: 'success',
        data: {
          found: true,
          sectionId: revision.sections[0]?.id,
          content: 'Install the sample package with the documented command.',
        },
      });

      const resources = await client.listResources();
      expect(resources.resources.map(({ uri }) => uri)).toContain('mcp-search-net://catalog');
      const resourceUris = [
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
      for (const uri of resourceUris) {
        const resource = await client.readResource({ uri });
        const content = resource.contents[0];
        expect(content).toMatchObject({ uri, mimeType: 'application/json' });
        if (content === undefined || !('text' in content)) {
          throw new Error(`Expected a text resource for ${uri}`);
        }
        expect(JSON.parse(content.text)).toMatchObject({
          schemaVersion: '1.0',
          contentTrust: 'EXTERNAL_UNTRUSTED_CONTENT',
          contentSafetyNotice: expect.stringContaining('untrusted data'),
        });
      }

      const largeSectionUri = `mcp-search-net://sections/${revision.sections[1]?.id}`;
      const largeSection = await client.readResource({ uri: largeSectionUri });
      const largeContent = largeSection.contents[0];
      if (largeContent === undefined || !('text' in largeContent)) {
        throw new Error('Expected the large section resource to contain JSON text');
      }
      expect(largeContent.text.length).toBeLessThanOrEqual(24_000);
      expect(JSON.parse(largeContent.text)).toMatchObject({
        entry: {
          section: {
            contentTruncated: true,
            content: expect.stringMatching(/^x{7999}…$/u),
          },
        },
      });

      for (let index = 0; index < 50; index += 1) {
        await container.catalog.upsertDocument({
          publicId: `bulk-${index}-${'p'.repeat(100)}`,
          sourceId: source.id,
          canonicalUrl: `https://example.test/bulk/${index}`,
          stableKey: `bulk-${index}`,
          title: `Bulk document ${index} ${'t'.repeat(800)}`,
          mimeType: 'text/markdown',
          language: 'en',
          status: 'ACTIVE',
        });
      }
      const boundedDocuments = await client.callTool({
        name: 'list_docs',
        arguments: { limit: 50 },
      });
      const boundedData = boundedDocuments.structuredContent as {
        readonly data: {
          readonly count: number;
          readonly total: number;
          readonly nextOffset: number | null;
          readonly truncated: boolean;
          readonly documents: readonly { readonly publicId: string }[];
        };
      };
      expect(JSON.stringify(boundedData.data).length).toBeLessThanOrEqual(20_000);
      expect(boundedData.data).toMatchObject({
        total: 51,
        nextOffset: boundedData.data.count,
        truncated: true,
      });
      expect(boundedData.data.count).toBeLessThan(boundedData.data.total);

      const nextOffset = boundedData.data.nextOffset;
      if (nextOffset === null) throw new Error('Expected a continuation offset');
      const continuedDocuments = await client.callTool({
        name: 'list_docs',
        arguments: { limit: 50, offset: nextOffset },
      });
      const continuedData = continuedDocuments.structuredContent as {
        readonly data: {
          readonly count: number;
          readonly documents: readonly { readonly publicId: string }[];
        };
      };
      expect(continuedData.data.count).toBeGreaterThan(0);
      expect(continuedData.data.documents[0]?.publicId).not.toBe(
        boundedData.data.documents.at(-1)?.publicId,
      );
    } finally {
      await client.close().catch(() => undefined);
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      container.history.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
