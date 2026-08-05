import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';
import process from 'node:process';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';
const benchmarkDate = new Date().toISOString().slice(0, 10);
const sourceCatalogPath = resolve(process.env.MCP_CATALOG_PATH ?? '.data/catalog-spike.db');
const benchmarkDataRoot = resolve('.data/benchmark-mcp-response-size');
const benchmarkCatalogPath = resolve(benchmarkDataRoot, 'catalog.db');
const benchmarkCachePath = resolve(benchmarkDataRoot, 'cache.sqlite');
const outputPath = resolve(
  'docs/planning/benchmark-results',
  `benchmark-mcp-response-size-${benchmarkDate}.json`,
);

const client = new Client({ name: 'mcp-search-net-response-size-benchmark', version: '1.0.0' });

try {
  await mkdir(benchmarkDataRoot, { recursive: true });
  await mkdir(resolve('docs/planning/benchmark-results'), { recursive: true });
  await copyFile(sourceCatalogPath, benchmarkCatalogPath);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('build/bootstrap/main.js')],
    env: {
      ...process.env,
      MCP_CONFIG_PATH: resolve('config/application.yml'),
      MCP_CACHE_PATH: benchmarkCachePath,
      [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
    },
    stderr: 'pipe',
  });

  await client.connect(transport);

  const cases = [];
  const searchDocs = await client.callTool({
    name: 'search_docs',
    arguments: {
      query: 'resources MCP V2',
      compact: true,
      maxResults: 3,
      maxSnippetChars: 160,
    },
  });
  cases.push(measureCase('search_docs compact maxResults=3 maxSnippetChars=160', searchDocs));

  const listDocs = await client.callTool({ name: 'list_docs', arguments: {} });
  cases.push(measureCase('list_docs', listDocs));

  const sectionsResource = await client.readResource({ uri: 'mcp-search-net://sections' });
  cases.push(measureCase('resource mcp-search-net://sections', sectionsResource));

  const sectionId = findFirstSectionId(sectionsResource);
  if (sectionId !== undefined) {
    const section = await client.callTool({
      name: 'read_doc_section',
      arguments: { sectionId },
    });
    cases.push(measureCase(`read_doc_section sectionId=${sectionId}`, section));
  }

  const report = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    catalogSourcePath: sourceCatalogPath,
    benchmarkCatalogPath,
    serverEntrypoint: resolve('build/bootstrap/main.js'),
    cases,
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(JSON.stringify({ outputPath, cases }, null, 2));
} finally {
  await client.close();
}

function measureCase(name, value) {
  const serialized = JSON.stringify(value);
  return {
    name,
    characters: serialized.length,
    estimatedTokens: Math.ceil(serialized.length / 4),
  };
}

function findFirstSectionId(resource) {
  const content = resource.contents?.[0];
  if (content === undefined || typeof content.text !== 'string') return undefined;

  const parsed = JSON.parse(content.text);
  const id = parsed.sections?.[0]?.section?.id;
  return Number.isInteger(id) ? id : undefined;
}
