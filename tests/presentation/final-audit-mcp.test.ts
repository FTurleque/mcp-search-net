import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { createContainer } from '../../src/bootstrap/container.js';
import {
  countUnicodeCharacters,
  MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
  MAX_EXTERNAL_SOURCE_NAME_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../src/domain/services/bounded-text.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';
import { createSearchDocsSchemas } from '../../src/presentation/mcp/schemas/search-docs-schema.js';
import { createSearchWebSchemas } from '../../src/presentation/mcp/schemas/search-web-schema.js';

describe('final audit MCP regressions', () => {
  it('projects oversized legacy catalog metadata without INTERNAL_ERROR', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-final-audit-mcp-'));
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const catalogPath = join(root, 'catalog.db');
    const container = createContainer({
      ...loaded,
      catalogPath,
      application: {
        ...loaded.application,
        cache: { ...loaded.application.cache, path: join(root, 'cache.sqlite') },
      },
    });
    const client = new Client({ name: 'final-audit-regression', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      const source = await container.catalog.addSource({
        sourceKey: 'legacy',
        displayName: 'Legacy source',
        baseUrl: 'https://example.test/',
        sourceType: 'documentation',
        language: 'en',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      });
      const revision = await container.catalog.commitDocumentRevision({
        document: {
          publicId: 'legacy-document',
          sourceId: source.id,
          canonicalUrl: 'https://example.test/legacy',
          stableKey: 'legacy',
          title: 'Legacy document',
          mimeType: 'text/markdown',
          language: 'en',
          status: 'ACTIVE',
        },
        version: {
          contentHash: 'legacy-v1',
          extractionMode: 'static',
          contentType: 'text/markdown',
          metadataJson: '{}',
        },
        sections: [
          {
            ordinal: 0,
            heading: 'Legacy heading',
            headingPath: 'Legacy heading',
            anchor: 'legacy',
            content: 'Legacy searchable content for contract regression.',
            contentHash: 'legacy-section',
            characterCount: 50,
          },
        ],
      });

      const database = new Database(catalogPath);
      database
        .prepare('UPDATE catalog_sources SET source_key = ?, display_name = ? WHERE id = ?')
        .run('s'.repeat(300), 'n'.repeat(500), source.id);
      database
        .prepare('UPDATE documents SET public_id = ?, title = ?, language = ? WHERE id = ?')
        .run('p'.repeat(300), '😀'.repeat(900), 'l'.repeat(120), revision.document.id);
      database
        .prepare(
          'UPDATE document_sections SET heading = ?, heading_path = ?, anchor = ? WHERE id = ?',
        )
        .run('h'.repeat(600), 'q'.repeat(2_000), 'a'.repeat(600), revision.sections[0]?.id);
      database.close();

      await container.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const search = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'searchable content' },
      });
      expect(search.isError).not.toBe(true);
      const searchResult = (
        search.structuredContent as {
          readonly data: {
            readonly results: readonly {
              readonly sourceKey: string;
              readonly sourceName: string;
              readonly documentPublicId: string;
              readonly title: string;
              readonly language: string;
            }[];
          };
        }
      ).data.results[0];
      expect(searchResult).toBeDefined();
      expect(countUnicodeCharacters(searchResult?.sourceKey ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
      );
      expect(countUnicodeCharacters(searchResult?.sourceName ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_SOURCE_NAME_CHARACTERS,
      );
      expect(countUnicodeCharacters(searchResult?.documentPublicId ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
      );
      expect(countUnicodeCharacters(searchResult?.title ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_TITLE_CHARACTERS,
      );
      expect(countUnicodeCharacters(searchResult?.language ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_LANGUAGE_CHARACTERS,
      );

      const listed = await client.callTool({ name: 'list_docs', arguments: { limit: 10 } });
      expect(listed.isError).not.toBe(true);
      const listedDocument = (
        listed.structuredContent as {
          readonly data: {
            readonly documents: readonly {
              readonly publicId: string;
              readonly sourceKey: string;
              readonly title: string;
              readonly language: string;
            }[];
          };
        }
      ).data.documents[0];
      expect(countUnicodeCharacters(listedDocument?.publicId ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
      );
      expect(countUnicodeCharacters(listedDocument?.sourceKey ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
      );
      expect(countUnicodeCharacters(listedDocument?.title ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_TITLE_CHARACTERS,
      );
      expect(countUnicodeCharacters(listedDocument?.language ?? '')).toBeLessThanOrEqual(
        MAX_EXTERNAL_LANGUAGE_CHARACTERS,
      );

      const section = await client.callTool({
        name: 'read_doc_section',
        arguments: { sectionId: revision.sections[0]?.id, maxCharacters: 500 },
      });
      expect(section.isError).not.toBe(true);

      const resource = await client.readResource({
        uri: `mcp-search-net://sections/${revision.sections[0]?.id}`,
      });
      const resourceContent = resource.contents[0];
      if (resourceContent === undefined || !('text' in resourceContent)) {
        throw new Error('Expected bounded JSON resource');
      }
      expect(countUnicodeCharacters(resourceContent.text)).toBeLessThanOrEqual(24_000);
    } finally {
      await client.close().catch(() => undefined);
      await container.mcpServer.close().catch(() => undefined);
      container.cache.close();
      container.catalog.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('advertises finite maxLength constraints for Unicode-bounded strings', () => {
    const docsSchema = z.toJSONSchema(createSearchDocsSchemas(5, 10).data) as Record<
      string,
      unknown
    >;
    const webSchema = z.toJSONSchema(createSearchWebSchemas(5, 10).data) as Record<string, unknown>;

    expect(findMaxLength(docsSchema, 'title')).toBe(MAX_EXTERNAL_TITLE_CHARACTERS * 2);
    expect(findMaxLength(webSchema, 'title')).toBe(MAX_EXTERNAL_TITLE_CHARACTERS * 2);
  });
});

function findMaxLength(schema: Record<string, unknown>, propertyName: string): number | undefined {
  const properties = schema['properties'];
  if (isRecord(properties)) {
    const direct = properties[propertyName];
    if (isRecord(direct) && typeof direct['maxLength'] === 'number') return direct['maxLength'];
  }
  for (const value of Object.values(schema)) {
    if (isRecord(value)) {
      const found = findMaxLength(value, propertyName);
      if (found !== undefined) return found;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (!isRecord(item)) continue;
        const found = findMaxLength(item, propertyName);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
