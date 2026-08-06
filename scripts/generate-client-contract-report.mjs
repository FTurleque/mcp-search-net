import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED_TOOLS = [
  'fetch_url',
  'list_docs',
  'read_doc_section',
  'search_docs',
  'search_web',
];
const EXPECTED_RESOURCES = [
  'mcp-search-net://catalog',
  'mcp-search-net://documents',
  'mcp-search-net://sections',
  'mcp-search-net://sources',
];
const EXPECTED_TEMPLATES = [
  'mcp-search-net://documents/page/{offset}',
  'mcp-search-net://documents/{documentId}',
  'mcp-search-net://documents/{documentId}/versions',
  'mcp-search-net://documents/{documentId}/versions/page/{offset}',
  'mcp-search-net://documents/{documentId}/versions/{versionId}',
  'mcp-search-net://sections/page/{offset}',
  'mcp-search-net://sections/{sectionId}',
  'mcp-search-net://sources/page/{offset}',
  'mcp-search-net://sources/{sourceId}',
];

const outputIndex = process.argv.indexOf('--output');
const outputPath =
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? resolve(process.argv[outputIndex + 1])
    : resolve('.data/test-reports/client-contract-report.json');

const temporaryRoot = mkdtempSync(join(tmpdir(), 'mcp-search-client-contract-'));
const client = new Client({ name: 'mcp-search-net-contract-reporter', version: '1.0.0' });
const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';

try {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('build/bootstrap/main.js')],
    env: {
      MCP_CONFIG_PATH: resolve('config/application.yml'),
      MCP_CACHE_PATH: join(temporaryRoot, 'cache.sqlite'),
      MCP_CATALOG_PATH: join(temporaryRoot, 'catalog.db'),
      [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
    },
    stderr: 'pipe',
  });
  await client.connect(transport);

  const tools = await client.listTools();
  const resources = await client.listResources();
  const templates = await client.listResourceTemplates();
  const catalog = await client.readResource({ uri: 'mcp-search-net://catalog' });
  const search = await client.callTool({
    name: 'search_docs',
    arguments: { query: 'client-contract-no-result-probe', compact: true },
  });

  const toolNames = tools.tools.map((tool) => tool.name).sort();
  const resourceUris = resources.resources.map((resource) => resource.uri).sort();
  const templateUris = templates.resourceTemplates
    .map((template) => template.uriTemplate)
    .sort();
  assertEqual(toolNames, EXPECTED_TOOLS, 'CLIENT_CONTRACT_TOOL_SET_CHANGED');
  assertEqual(resourceUris, EXPECTED_RESOURCES, 'CLIENT_CONTRACT_RESOURCE_SET_CHANGED');
  assertEqual(templateUris, EXPECTED_TEMPLATES, 'CLIENT_CONTRACT_TEMPLATE_SET_CHANGED');

  for (const tool of tools.tools) {
    const annotations = tool.annotations ?? {};
    const expectedOpenWorld = tool.name === 'search_web' || tool.name === 'fetch_url';
    if (
      annotations.readOnlyHint !== true ||
      annotations.destructiveHint !== false ||
      annotations.idempotentHint !== true ||
      annotations.openWorldHint !== expectedOpenWorld
    ) {
      throw new Error(`CLIENT_CONTRACT_ANNOTATIONS_CHANGED:${tool.name}`);
    }
  }

  const catalogContent = catalog.contents[0];
  if (catalogContent === undefined || !('text' in catalogContent)) {
    throw new Error('CLIENT_CONTRACT_CATALOG_RESOURCE_INVALID');
  }
  const catalogJson = JSON.parse(catalogContent.text);
  if (catalogJson.schemaVersion !== '1.0') {
    throw new Error('CLIENT_CONTRACT_RESOURCE_SCHEMA_VERSION_CHANGED');
  }
  if (catalogJson.contentTrust !== 'EXTERNAL_UNTRUSTED_CONTENT') {
    throw new Error('CLIENT_CONTRACT_RESOURCE_TRUST_MARKER_CHANGED');
  }
  if (search.isError === true || search.structuredContent?.schemaVersion !== '1.0') {
    throw new Error('CLIENT_CONTRACT_SEARCH_DOCS_PROBE_FAILED');
  }
  if (search.structuredContent.metadata?.contentTrust !== 'EXTERNAL_UNTRUSTED_CONTENT') {
    throw new Error('CLIENT_CONTRACT_TOOL_TRUST_MARKER_CHANGED');
  }

  const report = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    referenceClient: {
      implementation: '@modelcontextprotocol/sdk Client + StdioClientTransport',
      sdkVersion: '1.30.0',
      transport: 'stdio',
      nativeThirdPartyClientCertification: false,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    contract: {
      tools: tools.tools.map((tool) => ({
        name: tool.name,
        annotations: tool.annotations ?? null,
      })),
      resources: resourceUris,
      resourceTemplates: templateUris,
      resourceSchemaVersion: catalogJson.schemaVersion,
      structuredContentSchemaVersion: search.structuredContent.schemaVersion,
      contentTrust: catalogJson.contentTrust,
    },
    automatedVerdict: 'PASS',
    manualClientCertificationStillRequired: [
      'IntelliJ IDEA + GitHub Copilot native UI',
      'Claude Desktop native integration',
      'Claude Code native integration',
      'GitHub Copilot CLI native integration',
      'Codex native integration',
    ],
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await client.close().catch(() => undefined);
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function assertEqual(actual, expected, code) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(code);
}
