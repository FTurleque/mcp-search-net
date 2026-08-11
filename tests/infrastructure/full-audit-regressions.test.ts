/* eslint-disable @typescript-eslint/no-deprecated -- regression coverage for compatibility mutation paths */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  CacheGetOptions,
  CacheRecord,
  CacheRepository,
  CacheValidators,
} from '../../src/application/ports/cache-repository.js';
import type { Logger } from '../../src/application/ports/logger.js';
import {
  countUnicodeCharacters,
  MAX_EXTERNAL_ENGINE_NAME_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../src/domain/services/bounded-text.js';
import { RequestTimeoutError } from '../../src/domain/errors/domain-errors.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';
import { parseCatalogSourceConfig } from '../../src/cli/catalog-source-config.js';
import { SafeCacheRepository } from '../../src/infrastructure/cache/safe-cache-repository.js';
import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';
import { OfficialSourceYamlRegistry } from '../../src/infrastructure/config/official-source-yaml-registry.js';
import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import { extractPdfText } from '../../src/infrastructure/fetch/pdf-text-extractor.js';
import {
  SecureHttpGateway,
  type DownloadedResource,
  type SecureDownloadLimits,
} from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';
import {
  PublicUrlSecurityPolicy,
  isPublicAddress,
} from '../../src/infrastructure/security/public-url-security-policy.js';

const roots: string[] = [];
const catalogs: SqliteCatalogRepository[] = [];

afterEach(() => {
  catalogs.splice(0).forEach((catalog) => catalog.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('full audit regression coverage', () => {
  it('fails closed for reserved and non-global IP address space', () => {
    expect(isPublicAddress('192.88.99.2')).toBe(false);
    expect(isPublicAddress('fec0::1')).toBe(false);
    expect(isPublicAddress('4000::1')).toBe(false);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('requires the configured HTTPS port for official-source verification', () => {
    const registry = new OfficialSourceYamlRegistry({
      version: 1,
      sources: [
        {
          id: 'example',
          name: 'Example',
          domain: 'docs.example.com',
          baseUrl: 'https://docs.example.com/sdk',
          pathPrefix: '/sdk',
          includeSubdomains: true,
          githubOrganizations: ['ExampleOrg'],
          keywords: ['example sdk'],
          priority: 10,
          enabled: true,
        },
      ],
    });

    expect(registry.findByUrl('https://docs.example.com/sdk/start')?.id).toBe('example');
    expect(registry.findByUrl('https://docs.example.com:8443/sdk/start')).toBeUndefined();
    expect(registry.findByUrl('https://github.com/ExampleOrg/project')?.id).toBe('example');
    expect(registry.findByUrl('https://github.com:8443/ExampleOrg/project')).toBeUndefined();
  });

  it('truncates text by Unicode code points without splitting surrogate pairs', () => {
    const value = truncateUnicode('ab😀cd', 4);

    expect(value).toBe('ab😀…');
    expect(countUnicodeCharacters(value)).toBe(4);
    expect(value).not.toContain('\uFFFD');
  });

  it('honors an already-expired operation deadline during PDF extraction', async () => {
    await expect(
      extractPdfText(new Uint8Array([0x25, 0x50, 0x44, 0x46]), performance.now() - 1),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('bounds provider-controlled search fields before returning them', async () => {
    const hugeTitle = `Title ${'😀'.repeat(700)}`;
    const hugeSnippet = 'snippet '.repeat(1_000);
    const hugeEngine = 'engine-'.repeat(100);
    const provider = new SearxngSearchProvider(
      'http://127.0.0.1:8888',
      1_000,
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: hugeTitle,
                url: 'https://example.com/docs',
                content: hugeSnippet,
                engines: [hugeEngine],
              },
            ],
            unresponsive_engines: [hugeEngine],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await provider.search({
      query: SearchQuery.create('example docs'),
      language: 'en',
      maxResults: 1,
    });

    expect(countUnicodeCharacters(result.results[0]?.title ?? '')).toBeLessThanOrEqual(
      MAX_EXTERNAL_TITLE_CHARACTERS,
    );
    expect(countUnicodeCharacters(result.results[0]?.snippet ?? '')).toBeLessThanOrEqual(4_096);
    expect(countUnicodeCharacters(result.results[0]?.engines[0] ?? '')).toBeLessThanOrEqual(
      MAX_EXTERNAL_ENGINE_NAME_CHARACTERS,
    );
    expect(countUnicodeCharacters(result.unresponsiveEngines[0] ?? '')).toBeLessThanOrEqual(
      MAX_EXTERNAL_ENGINE_NAME_CHARACTERS,
    );
  });

  it('replaces a blocked remote canonical URL before content reaches consumers', async () => {
    const finalUrl = 'https://docs.example.com/page';
    const html = `<html><head><title>${'T'.repeat(700)}</title><link rel="canonical" href="http://127.0.0.1/admin"></head><body><h1>Documentation</h1><p>This page contains enough useful documentation words for deterministic extraction.</p></body></html>`;
    const policy = new PublicUrlSecurityPolicy(
      { allowedPorts: [80, 443], allowHttp: true },
      async () => ['93.184.216.34'],
    );
    const gateway = new StaticDownloadGateway(policy, {
      requestedUrl: finalUrl,
      finalUrl,
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: new TextEncoder().encode(html),
      redirectChain: [],
    });
    const fetcher = new Crawl4aiContentFetcher('http://127.0.0.1:11235', undefined, gateway);

    const fetched = await fetcher.fetch({
      url: WebUrl.createTransport(finalUrl),
      renderMode: 'static',
      timeoutMs: 1_000,
      maxResponseBytes: 1_000_000,
      maxRedirects: 3,
    });

    expect('notModified' in fetched).toBe(false);
    if ('notModified' in fetched) throw new Error('Unexpected 304');
    expect(fetched.canonicalUrl).toBe(finalUrl);
    expect(countUnicodeCharacters(fetched.title ?? '')).toBeLessThanOrEqual(
      MAX_EXTERNAL_TITLE_CHARACTERS,
    );
  });

  it('retries a failed cache after the recovery interval', async () => {
    const inner = new RecoveringCacheRepository();
    const logger = new RecordingLogger();
    const cache = new SafeCacheRepository(inner, true, logger, 0);

    await expect(cache.getSearch<string>('key')).resolves.toBeUndefined();
    const recovered = await cache.getSearch<string>('key');

    expect(recovered?.value).toBe('recovered');
    expect(inner.attempts).toBe(2);
    expect(logger.messages).toContain('cache_recovered');
  });

  it('keeps the legacy current-version FTS view synchronized after every mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-full-audit-'));
    roots.push(root);
    const catalog = new SqliteCatalogRepository(join(root, 'catalog.db'), {
      now: () => new Date(1_000),
    });
    catalogs.push(catalog);
    const source = await catalog.addSource({
      sourceKey: 'legacy-docs',
      displayName: 'Legacy docs',
      baseUrl: 'https://example.com/docs/',
      sourceType: 'documentation',
      language: 'en',
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    const document = await catalog.upsertDocument({
      publicId: 'legacy-doc',
      sourceId: source.id,
      canonicalUrl: 'https://example.com/docs/page',
      stableKey: 'page',
      title: 'Legacy page',
      mimeType: 'text/html',
      language: 'en',
      status: 'ACTIVE',
    });
    const first = await catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'legacy-v1',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await catalog.replaceDocumentSections(first.id, [
      {
        ordinal: 0,
        content: 'old searchable marker',
        contentHash: 'legacy-section-v1',
        characterCount: 21,
      },
    ]);
    await expect(catalog.searchDocuments({ query: 'old marker' })).resolves.toHaveLength(1);

    const second = await catalog.addDocumentVersion({
      documentId: document.id,
      contentHash: 'legacy-v2',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/html',
      metadataJson: '{}',
    });
    await expect(catalog.searchDocuments({ query: 'old marker' })).resolves.toEqual([]);

    await catalog.replaceDocumentSections(second.id, [
      {
        ordinal: 0,
        content: 'new searchable marker',
        contentHash: 'legacy-section-v2',
        characterCount: 21,
      },
    ]);
    await expect(catalog.searchDocuments({ query: 'new marker' })).resolves.toHaveLength(1);
    await expect(catalog.searchDocuments({ query: 'old marker' })).resolves.toEqual([]);
  });

  it('reports the actual invalid catalog document URL field', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  docs:
    display_name: Docs
    base_url: https://example.com/docs/
    documents:
      - stable_key: bad
        title: Bad document
        url: file:///tmp/private
`),
    ).toThrow('catalog source docs document 1 url must be an HTTP(S) URL');
  });
});

class StaticDownloadGateway extends SecureHttpGateway {
  public constructor(
    policy: PublicUrlSecurityPolicy,
    private readonly resource: DownloadedResource,
  ) {
    super(policy, {
      timeoutMs: 1_000,
      maxBytes: 1_000_000,
      maxRedirects: 3,
      maxConcurrency: 1,
      minimumDelayMs: 0,
      respectRobotsTxt: false,
      userAgent: 'test/1.0',
    });
  }

  public override download(
    _value: string,
    _conditionalHeaders: Readonly<Record<string, string>> = {},
    _context: { readonly requestId?: string; readonly tool?: 'fetch_url' } = {},
    _requestedLimits?: SecureDownloadLimits,
  ): Promise<DownloadedResource> {
    return Promise.resolve(this.resource);
  }
}

class RecoveringCacheRepository implements CacheRepository {
  public attempts = 0;

  public getSearch<T>(
    _key: string,
    _options?: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined> {
    this.attempts += 1;
    if (this.attempts === 1) return Promise.reject(new Error('temporary cache failure'));
    return Promise.resolve({
      value: 'recovered' as T,
      createdAt: new Date(0),
      expiresAt: new Date(10_000),
      stale: false,
    });
  }

  public setSearch<T>(
    _key: string,
    _value: T,
    _ttlMs: number,
    _validators?: CacheValidators,
  ): Promise<boolean> {
    return Promise.resolve(true);
  }

  public getContent<T>(
    _key: string,
    _options?: CacheGetOptions,
  ): Promise<CacheRecord<T> | undefined> {
    return Promise.resolve(undefined);
  }

  public setContent<T>(
    _key: string,
    _value: T,
    _ttlMs: number,
    _validators?: CacheValidators,
  ): Promise<boolean> {
    return Promise.resolve(true);
  }

  public deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }

  public close(): void {}
}

class RecordingLogger implements Logger {
  public readonly messages: string[] = [];

  public debug(message: string): void {
    this.messages.push(message);
  }

  public info(message: string): void {
    this.messages.push(message);
  }

  public warning(message: string): void {
    this.messages.push(message);
  }

  public error(message: string): void {
    this.messages.push(message);
  }

  public record(): void {}
}
