import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';
import { SqliteCacheRepository } from '../../src/infrastructure/cache/sqlite-cache-repository.js';
import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';

const root = mkdtempSync(join(tmpdir(), 'mcp-integration-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('real provider and SQLite integration', () => {
  it('observes healthy SearXNG and Crawl4AI services', async () => {
    const searchHealth = await fetch('http://127.0.0.1:8888/search?q=health&format=json');
    expect(searchHealth.ok).toBe(true);
    expect(await crawl4aiHealth()).toBe(200);
  });

  it('queries real SearXNG through its typed adapter', async () => {
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 15_000);
    const response = await provider.search({
      query: 'Model Context Protocol',
      language: 'en',
      limit: 5,
    });
    expect(response.results).toEqual(expect.any(Array));
    expect(response.unresponsiveEngines).toEqual(expect.any(Array));
    expect(response.results.every((result) => /^https?:\/\//u.test(result.url))).toBe(true);
  });

  it('renders prepared raw HTML through the real Crawl4AI endpoint', () => {
    const script = [
      'import json, requests',
      "html='<html><body><h1>Integration proof</h1><p>Real Crawl4AI endpoint.</p></body></html>'",
      "payload={'urls':['raw://'+html],'browser_config':{'text_mode':True,'light_mode':True},'crawler_config':{'check_robots_txt':False,'page_timeout':20000}}",
      "response=requests.post('http://127.0.0.1:11235/crawl',json=payload,headers={'Authorization':'Bearer mcp-search-local-development-token'},timeout=60)",
      'response.raise_for_status()',
      'print(response.text)',
    ].join(';');
    const output = execFileSync(
      'docker',
      ['exec', 'mcp-search-net-crawl4ai-1', 'python', '-c', script],
      { encoding: 'utf8', timeout: 90_000 },
    );
    const envelope = JSON.parse(output) as {
      results?: { success?: boolean; markdown?: { raw_markdown?: string } }[];
    };
    expect(envelope.results?.[0]).toMatchObject({ success: true });
    expect(envelope.results?.[0]?.markdown?.raw_markdown).toContain('Integration proof');
  });

  it('persists and reopens a real SQLite cache', async () => {
    const path = join(root, 'cache.sqlite');
    const clock = { now: () => new Date('2026-06-22T00:00:00.000Z') };
    const first = new SqliteCacheRepository(path, clock, 100, 86_400_000);
    await first.set('search', 'key', { result: 'value' }, 60_000);
    first.close();
    const reopened = new SqliteCacheRepository(path, clock, 100, 86_400_000);
    await expect(reopened.get('search', 'key')).resolves.toMatchObject({
      value: { result: 'value' },
    });
    reopened.close();
  });

  it('maps stopped-provider equivalents to stable unavailability errors', async () => {
    const provider = new SearxngSearchProvider('http://127.0.0.1:1', 200);
    await expect(provider.search({ query: 'docs', limit: 1 })).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_UNAVAILABLE',
    });
  });

  it('maps unavailable Crawl4AI during auto rendering', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com',
        finalUrl: 'https://example.com',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode('<p>tiny</p>'),
      }),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher('http://127.0.0.1:1', 200, undefined, gateway);
    await expect(fetcher.fetch('https://example.com', 'auto')).rejects.toMatchObject({
      code: 'CONTENT_PROVIDER_UNAVAILABLE',
    });
  });
});

async function crawl4aiHealth(): Promise<number> {
  try {
    return (await fetch('http://127.0.0.1:11235/health')).status;
  } catch {
    const output = execFileSync(
      'docker',
      [
        'exec',
        'mcp-search-net-crawl4ai-1',
        'python',
        '-c',
        "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:11235/health').status)",
      ],
      { encoding: 'utf8' },
    );
    return Number.parseInt(output.trim(), 10);
  }
}
