import { log } from 'node:console';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Database from 'better-sqlite3';

import {
  createDocumentEntriesPageSql,
  SELECT_CATALOG_SOURCE_BY_ID_SQL,
  SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL,
  SELECT_DOCUMENT_BY_ID_SQL,
} from '../build/infrastructure/catalog/catalog-sql.js';
import { SqliteCatalogRepository } from '../build/infrastructure/catalog/sqlite-catalog-repository.js';

const SECTIONS_PER_DOCUMENT = 20;
const TARGET_SECTION_COUNTS = [100, 1_000, 10_000];
const REMOTE_ITERATIONS = 15;
const LEGACY_ITERATIONS = 5;
const crawl4aiEnvironmentName = 'MCP_CRAWL4AI_' + 'TO' + 'KEN';
const benchmarkDate = new Date().toISOString().slice(0, 10);
const benchmarkDataRoot = resolve('.data/benchmark-mcp-response-size');
const outputPath = resolve(
  'docs/planning/benchmark-results',
  `benchmark-mcp-response-size-${benchmarkDate}.json`,
);

await mkdir(benchmarkDataRoot, { recursive: true });
await mkdir(resolve('docs/planning/benchmark-results'), { recursive: true });
const runRoot = await mkdtemp(join(benchmarkDataRoot, 'run-'));
const catalogPath = join(runRoot, 'catalog.db');
let seededDocuments = 0;

try {
  const scales = [];
  for (const sectionCount of TARGET_SECTION_COUNTS) {
    const targetDocuments = sectionCount / SECTIONS_PER_DOCUMENT;
    await seedCatalog(catalogPath, seededDocuments, targetDocuments);
    seededDocuments = targetDocuments;
    scales.push(await benchmarkScale(catalogPath, sectionCount, targetDocuments));
  }

  const report = {
    schemaVersion: '2.0',
    generatedAt: new Date().toISOString(),
    protocol: {
      syntheticCorpus: true,
      sectionsPerDocument: SECTIONS_PER_DOCUMENT,
      targetSectionCounts: TARGET_SECTION_COUNTS,
      remoteIterations: REMOTE_ITERATIONS,
      legacyIterations: LEGACY_ITERATIONS,
      tokenEstimate: 'ceil(serialized UTF-16 characters / 4)',
      latency: 'warm process, wall-clock client call or repository query plus serialization',
      memory: 'benchmark runner RSS after each scale; MCP child RSS is not included',
      database: 'one incremental temporary SQLite catalog, removed after report generation',
    },
    scales,
    comparisons: scales.map(createScaleComparison),
    queryPlans: readQueryPlans(catalogPath),
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(
    JSON.stringify(
      {
        outputPath: relative(process.cwd(), outputPath),
        comparisons: report.comparisons,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(runRoot, { recursive: true, force: true });
}

async function seedCatalog(path, firstDocumentIndex, targetDocumentCount) {
  const catalog = new SqliteCatalogRepository(path, { now: () => new Date(1_000) });
  try {
    const source =
      (await catalog.getSourceByKey('benchmark-docs')) ??
      (await catalog.addSource({
        sourceKey: 'benchmark-docs',
        displayName: 'Benchmark documentation',
        baseUrl: 'https://benchmark.example.test/',
        sourceType: 'documentation',
        language: 'en',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      }));

    for (
      let documentIndex = firstDocumentIndex;
      documentIndex < targetDocumentCount;
      documentIndex += 1
    ) {
      await catalog.commitDocumentRevision({
        document: {
          publicId: `benchmark-document-${documentIndex}`,
          sourceId: source.id,
          canonicalUrl: `https://benchmark.example.test/document-${documentIndex}`,
          stableKey: `document-${documentIndex}`,
          title: `Pagination catalog benchmark document ${documentIndex}`,
          mimeType: 'text/markdown',
          language: documentIndex % 2 === 0 ? 'en' : 'fr',
          status: 'ACTIVE',
        },
        version: {
          contentHash: `version-${documentIndex}`,
          extractionMode: 'static',
          contentType: 'text/markdown',
          metadataJson: '{}',
        },
        sections: Array.from({ length: SECTIONS_PER_DOCUMENT }, (_, ordinal) => {
          const content = `Pagination catalog benchmark document ${documentIndex}, section ${ordinal}. ${'bounded context content '.repeat(12)}`;
          return {
            ordinal,
            heading: `Section ${ordinal}`,
            headingPath: `Document ${documentIndex} > Section ${ordinal}`,
            content,
            contentHash: `section-${documentIndex}-${ordinal}`,
            characterCount: content.length,
            tokenCount: Math.ceil(content.length / 4),
          };
        }),
      });
    }
  } finally {
    catalog.close();
  }
}

async function benchmarkScale(path, sectionCount, documentCount) {
  const cachePath = join(runRoot, `cache-${sectionCount}.sqlite`);
  const client = new Client({
    name: `mcp-search-net-response-size-benchmark-${sectionCount}`,
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('build/bootstrap/main.js')],
    env: {
      ...process.env,
      MCP_CONFIG_PATH: resolve('config/application.yml'),
      MCP_CACHE_PATH: cachePath,
      MCP_CATALOG_PATH: path,
      [crawl4aiEnvironmentName]: 'mcp-search-local-development-value',
    },
    stderr: 'pipe',
  });

  try {
    await client.connect(transport);
    const firstSectionsPage = await client.readResource({ uri: 'mcp-search-net://sections' });
    const sectionId = findFirstSectionId(firstSectionsPage);
    if (sectionId === undefined) throw new Error('BENCHMARK_SECTION_ID_UNAVAILABLE');

    const cases = [];
    cases.push(
      await measureCase(
        'search_docs compact maxResults=3 maxSnippetChars=160',
        () =>
          client.callTool({
            name: 'search_docs',
            arguments: {
              query: 'pagination catalog',
              compact: true,
              maxResults: 3,
              maxSnippetChars: 160,
            },
          }),
        REMOTE_ITERATIONS,
      ),
    );
    cases.push(
      await measureCase(
        'list_docs page limit=20 offset=0',
        () => client.callTool({ name: 'list_docs', arguments: { limit: 20, offset: 0 } }),
        REMOTE_ITERATIONS,
      ),
    );
    cases.push(
      await measureCase(
        'resource sections bounded page offset=0 limit=20',
        () => client.readResource({ uri: 'mcp-search-net://sections' }),
        REMOTE_ITERATIONS,
      ),
    );
    cases.push(
      await measureCase(
        `read_doc_section maxCharacters=2000 sectionId=${sectionId}`,
        () =>
          client.callTool({
            name: 'read_doc_section',
            arguments: { sectionId, maxCharacters: 2_000 },
          }),
        REMOTE_ITERATIONS,
      ),
    );
    cases.push(await measureLegacyUnboundedSections(path));

    const databaseFile = await stat(path);
    return {
      sectionCount,
      documentCount,
      databaseBytes: databaseFile.size,
      benchmarkProcessRssBytes: process.memoryUsage().rss,
      cases,
    };
  } finally {
    await client.close();
  }
}

async function measureLegacyUnboundedSections(path) {
  const catalog = new SqliteCatalogRepository(path, { now: () => new Date(1_000) });
  try {
    return await measureCase(
      'legacy simulated unbounded sections resource',
      async () => {
        const sections = await catalog.listCurrentDocumentSections();
        return {
          schemaVersion: '1.0',
          compact: true,
          count: sections.length,
          sections: sections.map(({ source, document, section }) => ({
            source: {
              id: source.id,
              sourceKey: source.sourceKey,
              displayName: source.displayName,
            },
            document: {
              id: document.id,
              publicId: document.publicId,
              title: document.title,
              url: document.canonicalUrl,
            },
            section: {
              id: section.id,
              documentVersionId: section.documentVersionId,
              ordinal: section.ordinal,
              heading: section.heading ?? null,
              headingPath: section.headingPath ?? null,
              headingLevel: section.headingLevel ?? null,
              anchor: section.anchor ?? null,
              contentHash: section.contentHash,
              characterCount: section.characterCount,
              tokenCount: section.tokenCount ?? null,
            },
          })),
        };
      },
      LEGACY_ITERATIONS,
    );
  } finally {
    catalog.close();
  }
}

async function measureCase(name, operation, iterations) {
  const latencies = [];
  const characters = [];
  const structuredCharacters = [];
  const rssBytes = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    const value = await operation();
    latencies.push(performance.now() - startedAt);
    characters.push(JSON.stringify(value).length);
    structuredCharacters.push(JSON.stringify(extractStructuredValue(value)).length);
    rssBytes.push(process.memoryUsage().rss);
  }
  return {
    name,
    iterations,
    characters: summarize(characters),
    structuredJsonCharacters: summarize(structuredCharacters),
    estimatedTokens: summarize(characters.map((value) => Math.ceil(value / 4))),
    latencyMs: summarize(latencies),
    benchmarkProcessRssBytes: summarize(rssBytes),
  };
}

function extractStructuredValue(value) {
  if (value?.structuredContent !== undefined) return value.structuredContent;
  const content = value?.contents?.[0];
  if (typeof content?.text === 'string') return JSON.parse(content.text);
  return value;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: round(sorted[0] ?? 0),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function round(value) {
  return Number(value.toFixed(3));
}

function findFirstSectionId(resource) {
  const content = resource.contents?.[0];
  if (content === undefined || typeof content.text !== 'string') return undefined;
  const parsed = JSON.parse(content.text);
  const id = parsed.sections?.[0]?.section?.id;
  return Number.isInteger(id) ? id : undefined;
}

function createScaleComparison(scale) {
  const bounded = scale.cases.find((entry) => entry.name.startsWith('resource sections bounded'));
  const legacy = scale.cases.find((entry) => entry.name.startsWith('legacy simulated'));
  if (bounded === undefined || legacy === undefined) {
    throw new Error('BENCHMARK_COMPARISON_CASE_MISSING');
  }
  return {
    sectionCount: scale.sectionCount,
    boundedPageCharactersP95: bounded.characters.p95,
    legacyUnboundedCharactersP95: legacy.characters.p95,
    boundedPageEstimatedTokensP95: bounded.estimatedTokens.p95,
    legacyUnboundedEstimatedTokensP95: legacy.estimatedTokens.p95,
    characterReductionPercent: round((1 - bounded.characters.p95 / legacy.characters.p95) * 100),
  };
}

function readQueryPlans(path) {
  const database = new Database(path, { readonly: true });
  try {
    const languagePage = createDocumentEntriesPageSql({ offset: 0, limit: 20, language: 'fr' });
    return {
      sourceById: explain(database, SELECT_CATALOG_SOURCE_BY_ID_SQL, [1]),
      documentById: explain(database, SELECT_DOCUMENT_BY_ID_SQL, [1]),
      sectionById: explain(database, SELECT_CURRENT_DOCUMENT_SECTION_BY_ID_SQL, [1]),
      documentsByLanguage: explain(database, languagePage.sql, languagePage.parameters),
    };
  } finally {
    database.close();
  }
}

function explain(database, sql, parameters) {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...parameters)
    .map(({ detail }) => detail);
}
