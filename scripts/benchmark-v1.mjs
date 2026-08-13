import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const scenarios = [
  ['GitHub Copilot', 'GitHub Copilot MCP IntelliJ JetBrains configuration', ['docs.github.com']],
  ['MCP', 'Model Context Protocol TypeScript SDK STDIO security', ['modelcontextprotocol.io']],
  ['JetBrains', 'JetBrains IntelliJ Node.js TypeScript Docker configuration', ['jetbrains.com']],
  ['Java/OpenJDK', 'OpenJDK Java API migration notes current version', ['openjdk.org']],
  ['Maven', 'Apache Maven plugin build option documentation', ['maven.apache.org']],
  ['Quarkus', 'Quarkus scheduler configuration extension documentation', ['quarkus.io']],
  ['JavaFX', 'OpenJFX JavaFX modules official documentation', ['openjfx.io']],
  ['Oracle', 'Oracle Database SQL error version documentation', ['docs.oracle.com']],
  ['Sonar', 'Sonar rule correction IntelliJ documentation', ['docs.sonarsource.com']],
  ['Docker', 'Docker Compose healthcheck internal network documentation', ['docs.docker.com']],
];
const crawl4aiToken = process.env['MCP_CRAWL4AI_TOKEN'] ?? process.env['CRAWL4AI_API_TOKEN'];
if (!crawl4aiToken) {
  throw new Error('Set MCP_CRAWL4AI_TOKEN or CRAWL4AI_API_TOKEN before running benchmark:v1');
}

const client = new Client({ name: 'mcp-search-net-benchmark', version: '1.1.2' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('build/bootstrap/main.js')],
  env: {
    MCP_CONFIG_PATH: resolve('config/application.yml'),
    MCP_CRAWL4AI_TOKEN: crawl4aiToken,
  },
  stderr: 'pipe',
});

await client.connect(transport);
const results = [];
try {
  for (const [technology, query, expectedDomains] of scenarios) {
    const row = { technology, query, expectedDomains };
    try {
      const first = await timedCall('search_web', { query, sourcePolicy: 'prefer', maxResults: 5 });
      const second = await timedCall('search_web', {
        query,
        sourcePolicy: 'prefer',
        maxResults: 5,
      });
      const search = first.structured.data.results;
      const expectedIndex = search.findIndex((item) =>
        expectedDomains.some(
          (domain) => item.domain === domain || item.domain.endsWith(`.${domain}`),
        ),
      );
      Object.assign(row, {
        searchMissMs: first.elapsedMs,
        searchHitMs: second.elapsedMs,
        firstCacheStatus: first.structured.metadata.cacheStatus,
        secondCacheStatus: second.structured.metadata.cacheStatus,
        resultCount: search.length,
        officialCount: search.filter((item) => item.sourceStatus === 'VERIFIED_OFFICIAL').length,
        expectedRank: expectedIndex < 0 ? null : expectedIndex + 1,
        datedResultCount: search.filter((item) => item.publishedAt || item.updatedAt).length,
      });
      if (expectedIndex >= 0) {
        const target = search[expectedIndex];
        const fetched = await timedCall('fetch_url', {
          url: target.url,
          query: technology,
          maxSections: 5,
          maxCharacters: 12_000,
          renderMode: 'static',
        });
        Object.assign(row, {
          fetchMs: fetched.elapsedMs,
          extractionSucceeded: true,
          extractionCacheStatus: fetched.structured.metadata.cacheStatus,
          extractedSections: fetched.structured.data.sectionCount,
          contextCharacters: fetched.structured.data.markdown.length,
          extractionWarnings: fetched.structured.warnings.map((warning) => warning.code),
        });
      } else {
        Object.assign(row, {
          extractionSucceeded: false,
          extractionError: 'EXPECTED_DOMAIN_NOT_FOUND',
        });
      }
    } catch (error) {
      Object.assign(row, { extractionSucceeded: false, error: publicMessage(error) });
    }
    results.push(row);
  }
} finally {
  await client.close();
}

const officialCount = results.reduce((sum, row) => sum + (row.officialCount ?? 0), 0);
const totalCount = results.reduce((sum, row) => sum + (row.resultCount ?? 0), 0);
const successfulExtractions = results.filter((row) => row.extractionSucceeded).length;
const summary = {
  generatedAt: new Date().toISOString(),
  scenarioCount: results.length,
  officialRate: ratio(officialCount, totalCount),
  relevanceTop5Rate: ratio(
    results.filter((row) => row.expectedRank !== null && row.expectedRank !== undefined).length,
    results.length,
  ),
  datedResultRate: ratio(
    results.reduce((sum, row) => sum + (row.datedResultCount ?? 0), 0),
    totalCount,
  ),
  extractionSuccessRate: ratio(successfulExtractions, results.length),
  averageContextCharacters: average(results.flatMap((row) => row.contextCharacters ?? [])),
  averageSearchMissMs: average(results.flatMap((row) => row.searchMissMs ?? [])),
  averageSearchHitMs: average(results.flatMap((row) => row.searchHitMs ?? [])),
  resilience: 'Covered by test:resilience and test:integration provider-unavailable scenarios',
};
process.stdout.write(`${JSON.stringify({ summary, results }, null, 2)}\n`);

async function timedCall(name, args) {
  const started = performance.now();
  const response = await client.callTool({ name, arguments: args });
  const elapsedMs = Number((performance.now() - started).toFixed(3));
  if (response.isError === true || !response.structuredContent) {
    throw new Error(`${name} failed: ${JSON.stringify(response._meta ?? response.content)}`);
  }
  return { elapsedMs, structured: response.structuredContent };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}
function average(values) {
  return values.length === 0
    ? null
    : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}
function publicMessage(error) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
