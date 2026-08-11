import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { SearxngSearchProvider } from '../../src/infrastructure/search/searxng-search-provider.js';
import { Crawl4aiContentFetcher } from '../../src/infrastructure/fetch/crawl4ai-content-fetcher.js';
import type { SecureHttpGateway } from '../../src/infrastructure/fetch/secure-http-gateway.js';
import { SearchQuery } from '../../src/domain/value-objects/search-query.js';
import { WebUrl } from '../../src/domain/value-objects/web-url.js';

const live = process.env['RUN_LIVE_SERVICES'] === '1';

describe.runIf(live)('live provider services', () => {
  it('observes healthy SearXNG and Crawl4AI services', async () => {
    const searchHealth = await fetch('http://127.0.0.1:8888/search?q=health&format=json');
    expect(searchHealth.ok).toBe(true);
    expect(await crawl4aiHealth()).toBe(200);
  });

  it('queries real SearXNG through its typed adapter', async () => {
    const provider = new SearxngSearchProvider('http://127.0.0.1:8888', 15_000);
    const response = await provider.search({
      query: SearchQuery.create('Model Context Protocol'),
      language: 'en',
      maxResults: 5,
    });
    expect(response.results).toEqual(expect.any(Array));
    expect(response.unresponsiveEngines).toEqual(expect.any(Array));
    expect(response.results.every((result) => /^https?:\/\//u.test(result.url))).toBe(true);
  });

  it('renders prepared raw HTML through the authenticated Crawl4AI endpoint', () => {
    const script = [
      'import json, os, requests',
      "html='<html><body><h1>Integration proof</h1><p>Real Crawl4AI endpoint.</p></body></html>'",
      "payload={'urls':['raw://'+html],'browser_config':{'text_mode':True,'light_mode':True},'crawler_config':{'check_robots_txt':False,'page_timeout':20000}}",
      "response=requests.post('http://127.0.0.1:11235/crawl',json=payload,headers={'Authorization':'Bearer '+os.environ['CRAWL4AI_API_TOKEN']},timeout=60)",
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

  it('uses the real Crawl4AI adapter without mislabeling discarded render output', async () => {
    const gateway = {
      download: async () => ({
        requestedUrl: 'https://example.com/dynamic',
        finalUrl: 'https://example.com/dynamic',
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode('<html><body><div>tiny</div></body></html>'),
      }),
    } as unknown as SecureHttpGateway;
    const fetcher = new Crawl4aiContentFetcher(
      'http://127.0.0.1:11235',
      requireCrawl4aiToken(),
      gateway,
    );
    await expect(
      fetcher.fetch({
        url: WebUrl.create('https://example.com/dynamic'),
        renderMode: 'auto',
        timeoutMs: 20_000,
        maxResponseBytes: 1_000_000,
        maxRedirects: 5,
      }),
    ).resolves.toMatchObject({
      extractionMode: 'static',
    });
  });
});

function requireCrawl4aiToken(): string {
  const token = process.env['CRAWL4AI_API_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('CRAWL4AI_API_TOKEN is required for live provider tests');
  }
  return token;
}

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
