import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSearchCacheKey,
  normalizeSearchRequest,
} from '../../src/application/services/search-request.js';
import {
  countUnicodeCharacters,
  MAX_EXTERNAL_DOCUMENT_SECTIONS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_PERSISTED_DOCUMENT_SECTIONS,
} from '../../src/domain/services/bounded-text.js';
import { extractDocumentSections } from '../../src/domain/services/content-selection.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('follow-up audit regression coverage', () => {
  it('bounds Markdown headings and section materialization before catalog ingestion', () => {
    const hugeHeading = `# ${'😀'.repeat(1_000)}\nbody`;
    const boundedHeading = extractDocumentSections(hugeHeading)[0]?.heading ?? '';
    expect(countUnicodeCharacters(boundedHeading)).toBeLessThanOrEqual(
      MAX_EXTERNAL_HEADING_CHARACTERS,
    );

    const manyHeadings = Array.from(
      { length: MAX_EXTERNAL_DOCUMENT_SECTIONS + 200 },
      (_, index) => `# Heading ${index}\nbody ${index}`,
    ).join('\n');
    const sections = extractDocumentSections(manyHeadings);
    expect(sections.length).toBeLessThanOrEqual(MAX_EXTERNAL_DOCUMENT_SECTIONS);
  });

  it('normalizes valid detected languages and discards oversized provider values', async () => {
    const provider = new SearxngSearchProvider(
      'http://127.0.0.1:8888',
      1_000,
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'valid language',
                url: 'https://example.com/valid',
                content: 'valid',
                language: 'EN-us',
              },
              {
                title: 'oversized language',
                url: 'https://example.com/oversized',
                content: 'oversized',
                language: 'x'.repeat(MAX_EXTERNAL_LANGUAGE_CHARACTERS + 1),
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await provider.search({
      query: SearchQuery.create('language metadata'),
      language: 'en',
      maxResults: 2,
    });

    expect(result.results[0]?.detectedLanguage).toBe('en-US');
    expect(result.results[1]?.detectedLanguage).toBeUndefined();
  });

  it('invalidates pre-hardening search cache keys by contract version', () => {
    const request = normalizeSearchRequest({
      query: 'cache hardening',
      language: 'en-US',
      maxResults: 5,
      sourcePolicy: 'prefer',
      allowedDomains: [],
      excludedDomains: [],
    });
    const behavior = { providerOversampling: 3, maxSnippetChars: 500 };
    const current = createSearchCacheKey(request, 'official-v1', behavior);
    const legacy = createHash('sha256')
      .update(
        JSON.stringify({
          query: request.query.toLowerCase(),
          language: request.language,
          timeRange: request.timeRange ?? null,
          maxResults: request.maxResults,
          sourcePolicy: request.sourcePolicy,
          allowedDomains: request.allowedDomains,
          excludedDomains: request.excludedDomains,
          officialSourcesVersion: 'official-v1',
          providerOversampling: behavior.providerOversampling,
          maxSnippetChars: behavior.maxSnippetChars,
          contractVersion: 2,
        }),
      )
      .digest('hex');

    expect(current).not.toBe(legacy);
  });

  it('keeps catalog snippets Unicode-safe around supplementary-plane characters', async () => {
    const catalog = createCatalog();
    const source = await createSource(catalog);
    const content = `${'😀'.repeat(120)} target marker ${'😀'.repeat(120)}`;
    await catalog.commitDocumentRevision({
      document: {
        publicId: 'unicode-doc',
        sourceId: source.id,
        canonicalUrl: 'https://example.com/docs/unicode',
        stableKey: 'unicode',
        title: 'Unicode document',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'unicode-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          heading: 'Unicode',
          headingPath: 'Unicode',
          content,
          contentHash: 'unicode-section',
          characterCount: countUnicodeCharacters(content),
        },
      ],
    });

    const [result] = await catalog.searchDocuments({ query: 'target marker', limit: 1 });
    expect(result).toBeDefined();
    expect(hasUnpairedSurrogate(result?.snippet ?? '')).toBe(false);
    expect(countUnicodeCharacters(result?.snippet ?? '')).toBeLessThanOrEqual(162);
  });

  it('bounds persisted section metadata and rejects excessive section fan-out', async () => {
    const catalog = createCatalog();
    const source = await createSource(catalog);
    const hugeHeading = '😀'.repeat(MAX_EXTERNAL_HEADING_CHARACTERS + 100);
    const committed = await catalog.commitDocumentRevision({
      document: {
        publicId: 'bounded-doc',
        sourceId: source.id,
        canonicalUrl: 'https://example.com/docs/bounded',
        stableKey: 'bounded',
        title: 'Bounded document',
        mimeType: 'text/markdown',
        language: 'en',
        status: 'ACTIVE',
      },
      version: {
        contentHash: 'bounded-v1',
        extractionMode: 'static',
        contentType: 'text/markdown',
        metadataJson: '{}',
      },
      sections: [
        {
          ordinal: 0,
          heading: hugeHeading,
          headingPath: hugeHeading,
          anchor: hugeHeading,
          content: 'bounded content',
          contentHash: 'bounded-section',
          characterCount: 15,
        },
      ],
    });
    expect(countUnicodeCharacters(committed.sections[0]?.heading ?? '')).toBeLessThanOrEqual(
      MAX_EXTERNAL_HEADING_CHARACTERS,
    );

    const excessiveSections = Array.from(
      { length: MAX_PERSISTED_DOCUMENT_SECTIONS + 1 },
      (_, ordinal) => ({
        ordinal,
        content: `section ${ordinal}`,
        contentHash: `hash-${ordinal}`,
        characterCount: `section ${ordinal}`.length,
      }),
    );
    await expect(
      catalog.commitDocumentRevision({
        document: {
          publicId: 'too-many-sections',
          sourceId: source.id,
          canonicalUrl: 'https://example.com/docs/too-many',
          stableKey: 'too-many',
          title: 'Too many sections',
          mimeType: 'text/markdown',
          language: 'en',
          status: 'ACTIVE',
        },
        version: {
          contentHash: 'too-many-v1',
          extractionMode: 'static',
          contentType: 'text/markdown',
          metadataJson: '{}',
        },
        sections: excessiveSections,
      }),
    ).rejects.toThrow('CATALOG_DOCUMENT_SECTION_LIMIT_EXCEEDED');
  });

  it('persists PLAN separately from execution status semantics', async () => {
    const catalog = createCatalog();
    const running = await catalog.startCatalogSyncRun({
      runKind: 'PLAN',
      startedAt: new Date(1_000),
    });
    expect(running.runKind).toBe('PLAN');

    const completed = await catalog.completeCatalogSyncRun(running.id, {
      completedAt: new Date(2_000),
      status: 'CANCELLED',
      documentsChecked: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      documentsFailed: 0,
      errorSummary: 'DRY_RUN_PLAN',
    });
    expect(completed).toMatchObject({ runKind: 'PLAN', status: 'CANCELLED' });
  });

  it('reports static extraction when unusable native-render output is discarded', async () => {
    const finalUrl = 'https://example.com/tiny';
    const gateway = {
      download: vi.fn(async () => ({
        requestedUrl: finalUrl,
        finalUrl,
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode('<html><body><p>tiny static</p></body></html>'),
        redirectChain: [],
      })),
    } as unknown as SecureHttpGateway;
    const renderer = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [{ success: true, markdown: 'still tiny' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const fetcher = new Crawl4aiContentFetcher('http://crawl4ai', undefined, gateway, renderer);

    const result = await fetcher.fetch({
      url: WebUrl.createTransport(finalUrl),
      renderMode: 'auto',
      timeoutMs: 1_000,
      maxResponseBytes: 1_000_000,
      maxRedirects: 3,
    });
    if ('notModified' in result) throw new Error('Unexpected 304');

    expect(renderer).toHaveBeenCalledOnce();
    expect(result.extractionMode).toBe('static');
    expect(result.markdown).toContain('tiny static');
    expect(result.markdown).not.toContain('still tiny');
  });
});

function createCatalog(): SqliteCatalogRepository {
  const root = mkdtempSync(join(tmpdir(), 'mcp-followup-audit-'));
  roots.push(root);
  const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), {
    now: () => new Date(1_000),
  });
  catalogs.push(catalog);
  return catalog;
}

async function createSource(catalog: SqliteCatalogRepository) {
  return catalog.addSource({
    sourceKey: `docs-${catalogs.length}`,
    displayName: 'Documentation',
    baseUrl: 'https://example.com/docs/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
