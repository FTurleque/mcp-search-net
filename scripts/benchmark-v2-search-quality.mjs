#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import Database from 'better-sqlite3';

import { RerankedSearchCatalogDocuments } from '../build/application/use-cases/reranked-search-catalog-documents.js';
import {
  measureSearchQueryQuality,
  percentile,
  roundMetric,
  summarizeSearchQuality,
} from '../build/application/services/search-quality-metrics.js';
import { SyncCatalogDocuments } from '../build/application/use-cases/sync-catalog-documents.js';
import { SqliteCatalogRepository } from '../build/infrastructure/catalog/sqlite-catalog-repository.js';

const root = resolve(import.meta.dirname, '..');
const args = parseArgs(process.argv.slice(2));
const manifest = parseManifest(
  readJson(resolve(root, 'benchmarks/v2-search-quality/corpus-manifest.json')),
);
const queries = parseQuerySet(readJson(resolve(root, 'benchmarks/v2-search-quality/queries.json')));
const sectionsPerDocument = positiveInteger(
  args.sectionsPerDocument,
  manifest.defaultSectionsPerDocument,
);
const repetitions = positiveInteger(args.repetitions, 6);
const warmupRounds = positiveInteger(args.warmupRounds, 2);
const catalogPath = resolve(root, args.path ?? '.data/benchmark-v2-search-quality.db');
const outputPath = resolve(
  root,
  args.output ?? `docs/planning/benchmark-results/benchmark-v2-search-quality-${today()}.json`,
);

resetCatalog(catalogPath);
mkdirSync(dirname(outputPath), { recursive: true });

const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
const repository = new SqliteCatalogRepository(catalogPath, clock);
const rerankedSearch = new RerankedSearchCatalogDocuments(repository);

try {
  const seedStarted = performance.now();
  const seeded = await seedCorpus(repository, manifest, sectionsPerDocument);
  const seedDurationMs = performance.now() - seedStarted;

  const rebuildStarted = performance.now();
  const rebuild = await repository.rebuildSearchIndex();
  const rebuildDurationMs = performance.now() - rebuildStarted;

  await warmup(queries, repository, rerankedSearch, warmupRounds);
  const quality = await measureQuality(queries, repository, rerankedSearch);
  const performanceResult = await measurePerformance(
    queries,
    repository,
    rerankedSearch,
    repetitions,
  );
  const storage = measureStorage(catalogPath);
  const incrementalSyncMs = await measureIncrementalSync(repository, manifest, clock);
  const decision = decideStrategy(quality, performanceResult, seeded.sections);

  const report = {
    schemaVersion: '2.0',
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    corpus: {
      sourceCount: manifest.sources.length,
      documentCount: seeded.documents,
      sectionCount: seeded.sections,
      languages: [...new Set(manifest.sources.map((source) => source.language))].sort(),
      sectionsPerDocument,
      seedDurationMs: roundMetric(seedDurationMs, 2),
      synthetic: true,
      sourceModel: 'versioned official-documentation domain manifest',
    },
    protocol: {
      queryCount: queries.length,
      warmupRounds,
      repetitions,
      order: 'alternating lexical-first / reranker-first by query and repetition',
      resultCutoff: 10,
    },
    quality,
    performance: {
      ...performanceResult,
      rebuild: {
        durationMs: roundMetric(rebuildDurationMs, 2),
        indexedSections: rebuild.indexedSections,
      },
      incrementalSyncMs: roundMetric(incrementalSyncMs, 2),
      memoryRssBytes: process.memoryUsage().rss,
      ...storage,
    },
    thresholds: {
      recallAt10: 0.85,
      mrrAt10: 0.7,
      ndcgAt10: 0.75,
      p95MsAt10000Sections: 150,
      minimumRerankerQualityGain: 0.02,
      maximumRerankerP95Ratio: 2.5,
    },
    decision,
  };

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`Benchmark written to ${outputPath}\n`);
} finally {
  repository.close();
}

async function seedCorpus(repositoryValue, manifestValue, sectionCount) {
  let documents = 0;
  let sections = 0;
  for (const sourceDefinition of manifestValue.sources) {
    const source = await repositoryValue.addSource({
      sourceKey: sourceDefinition.sourceKey,
      displayName: sourceDefinition.displayName,
      baseUrl: sourceDefinition.baseUrl,
      sourceType: 'documentation',
      language: sourceDefinition.language,
      freshnessPolicy: 'manual',
      syncStrategy: 'manual',
      enabled: true,
    });
    for (const encodedTopic of sourceDefinition.topics) {
      const topic = parseTopic(encodedTopic);
      const publicId = documentPublicId(sourceDefinition.sourceKey, topic.id);
      const generatedSections = Array.from({ length: sectionCount }, (_, index) =>
        createSection(sourceDefinition, topic, index),
      );
      const combined = generatedSections.map((section) => section.content).join('\n');
      await repositoryValue.commitDocumentRevision({
        document: {
          publicId,
          sourceId: source.id,
          canonicalUrl: `${sourceDefinition.baseUrl}/${topic.id}`,
          stableKey: topic.id,
          title: topic.title,
          mimeType: 'text/markdown',
          language: sourceDefinition.language,
          status: 'ACTIVE',
        },
        version: {
          versionLabel: 'benchmark-v2.13',
          contentHash: sha256(combined),
          publishedAt: new Date('2026-07-29T00:00:00.000Z'),
          extractionMode: 'static',
          contentType: 'text/markdown',
          metadataJson: JSON.stringify({ benchmark: 'v2.13', synthetic: true }),
        },
        sections: generatedSections,
      });
      documents += 1;
      sections += generatedSections.length;
    }
  }
  return { documents, sections };
}

function createSection(source, topic, zeroBasedIndex) {
  const ordinal = zeroBasedIndex + 1;
  const versionHint =
    source.sourceKey === 'nodejs' || source.sourceKey === 'openjdk' ? '24' : 'current';
  const content = [
    `${topic.title}.`,
    `Official-source benchmark surrogate for ${source.displayName}.`,
    `Reference version ${versionHint}.`,
    `${topic.title}.`,
    `Section ${ordinal} covers ${topic.title} with configuration, API, error handling and operational examples.`,
    `Stable identifiers: ${topic.id} ${source.sourceKey}.`,
  ].join(' ');
  return {
    ordinal,
    heading: `${topic.shortTitle} ${ordinal}`,
    headingPath: `${source.displayName} > ${topic.shortTitle}`,
    headingLevel: 2,
    anchor: `${topic.id}-${ordinal}`,
    content,
    contentHash: sha256(content),
    characterCount: content.length,
    tokenCount: content.split(/\s+/u).length,
  };
}

async function warmup(queryDefinitions, repositoryValue, reranked, rounds) {
  for (let round = 0; round < rounds; round += 1) {
    for (const query of queryDefinitions) {
      await runLexical(repositoryValue, query);
      await runReranked(reranked, query);
    }
  }
}

async function measureQuality(queryDefinitions, repositoryValue, reranked) {
  const lexicalCases = [];
  const rerankedCases = [];
  const failures = [];
  const categories = new Map();

  for (const query of queryDefinitions) {
    const lexical = await runLexical(repositoryValue, query);
    const rerankedResult = await runReranked(reranked, query);
    const lexicalMetrics = measureSearchQueryQuality(
      lexical.map((entry) => entry.document.publicId),
      query.judgments,
    );
    const rerankedMetrics = measureSearchQueryQuality(
      rerankedResult.results.map((entry) => entry.documentPublicId),
      query.judgments,
    );
    lexicalCases.push(lexicalMetrics);
    rerankedCases.push(rerankedMetrics);

    const category = categories.get(query.category) ?? { lexical: [], reranked: [] };
    category.lexical.push(lexicalMetrics);
    category.reranked.push(rerankedMetrics);
    categories.set(query.category, category);

    if (lexicalMetrics.recallAt10 < 1 || rerankedMetrics.recallAt10 < 1) {
      failures.push({
        id: query.id,
        category: query.category,
        query: query.query,
        lexicalRecallAt10: roundMetric(lexicalMetrics.recallAt10),
        rerankedRecallAt10: roundMetric(rerankedMetrics.recallAt10),
      });
    }
  }

  return {
    lexical: roundedSummary(summarizeSearchQuality(lexicalCases)),
    reranked: roundedSummary(summarizeSearchQuality(rerankedCases)),
    byCategory: Object.fromEntries(
      [...categories.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, value]) => [
          category,
          {
            lexical: roundedSummary(summarizeSearchQuality(value.lexical)),
            reranked: roundedSummary(summarizeSearchQuality(value.reranked)),
          },
        ]),
    ),
    failures,
  };
}

async function measurePerformance(queryDefinitions, repositoryValue, reranked, repeatCount) {
  const lexicalDurations = [];
  const rerankedDurations = [];
  for (let repetition = 0; repetition < repeatCount; repetition += 1) {
    for (const [queryIndex, query] of queryDefinitions.entries()) {
      if ((repetition + queryIndex) % 2 === 0) {
        lexicalDurations.push(await timed(() => runLexical(repositoryValue, query)));
        rerankedDurations.push(await timed(() => runReranked(reranked, query)));
      } else {
        rerankedDurations.push(await timed(() => runReranked(reranked, query)));
        lexicalDurations.push(await timed(() => runLexical(repositoryValue, query)));
      }
    }
  }
  return {
    lexical: latencySummary(lexicalDurations),
    reranked: latencySummary(rerankedDurations),
  };
}

async function measureIncrementalSync(repositoryValue, manifestValue, clockValue) {
  const source = manifestValue.sources.at(0);
  if (source === undefined) throw new Error('Benchmark requires at least one source');

  const stableKey = 'benchmark-incremental-sync';
  let revision = 1;
  const fetcher = {
    async fetch() {
      const markdown = `Incremental benchmark document revision ${revision}.`;
      return {
        requestedUrl: `${source.baseUrl}/${stableKey}`,
        finalUrl: `${source.baseUrl}/${stableKey}`,
        canonicalUrl: `${source.baseUrl}/${stableKey}`,
        title: 'Incremental benchmark document',
        markdown,
        documentSections: [{ heading: 'Incremental sync', markdown }],
        contentType: 'text/markdown',
        fetchedAt: clockValue.now().toISOString(),
        extractionMode: 'static',
        statusCode: 200,
        contentHash: sha256(markdown),
        redirectChain: [],
        metadata: { benchmark: 'v2.13' },
        links: [],
      };
    },
  };
  const sync = new SyncCatalogDocuments(
    repositoryValue,
    fetcher,
    clockValue,
    async () => undefined,
  );
  const options = {
    sourceKey: source.sourceKey,
    documents: [
      {
        sourceKey: source.sourceKey,
        stableKey,
        title: 'Incremental benchmark document',
        url: `${source.baseUrl}/${stableKey}`,
        language: source.language,
        mimeType: 'text/markdown',
        enabled: true,
      },
    ],
    timeoutMs: 5_000,
    maxResponseBytes: 1_000_000,
    maxRedirects: 2,
    rateLimitMs: 0,
  };

  const initial = await sync.execute(options);
  if (initial.addedCount !== 1) {
    throw new Error(`Expected one initial sync insert, got ${initial.addedCount}`);
  }
  revision = 2;
  const started = performance.now();
  const updated = await sync.execute(options);
  const duration = performance.now() - started;
  if (updated.updatedCount !== 1) {
    throw new Error(`Expected one incremental update, got ${updated.updatedCount}`);
  }
  return duration;
}

function measureStorage(path) {
  let ftsBytes;
  const database = new Database(path, { readonly: true });
  try {
    try {
      const row = database
        .prepare(
          "SELECT coalesce(sum(pgsize), 0) AS bytes FROM dbstat WHERE name LIKE 'document_section_fts%'",
        )
        .get();
      ftsBytes = Number(row?.bytes ?? 0);
    } catch {
      ftsBytes = null;
    }
    const indexed = database.prepare('SELECT count(*) AS count FROM document_section_fts').get();
    return {
      catalogBytes: statSync(path).size,
      ftsBytes,
      indexedSections: Number(indexed?.count ?? 0),
    };
  } finally {
    database.close();
  }
}

function decideStrategy(quality, performanceResult, sectionCount) {
  const lexical = quality.lexical;
  const reranked = quality.reranked;
  const lexicalPass =
    lexical.recallAt10 >= 0.85 && lexical.mrrAt10 >= 0.7 && lexical.ndcgAt10 >= 0.75;
  const performancePass = sectionCount < 10_000 || performanceResult.lexical.p95Ms <= 150;
  const qualityGain = Math.max(
    reranked.recallAt10 - lexical.recallAt10,
    reranked.ndcgAt10 - lexical.ndcgAt10,
  );
  const p95Ratio =
    performanceResult.lexical.p95Ms === 0
      ? 1
      : performanceResult.reranked.p95Ms / performanceResult.lexical.p95Ms;
  const rerankerEarnsKeep =
    qualityGain >= 0.02 && performanceResult.reranked.p95Ms <= 150 && p95Ratio <= 2.5;

  if (lexicalPass && performancePass && !rerankerEarnsKeep) {
    return {
      recommendation: 'fts5-bm25',
      lexicalThresholdsMet: true,
      performanceThresholdMet: true,
      keepHashedLexicalReranker: false,
      evaluateLocalEmbeddings: false,
      reason:
        'FTS5/BM25 meets quality and latency thresholds and the hashed lexical reranker does not earn its complexity.',
      qualityGain: roundMetric(qualityGain),
      rerankerP95Ratio: roundMetric(p95Ratio),
    };
  }
  if (rerankerEarnsKeep && performancePass) {
    return {
      recommendation: 'fts5-plus-hashed-lexical-reranker',
      lexicalThresholdsMet: lexicalPass,
      performanceThresholdMet: true,
      keepHashedLexicalReranker: true,
      evaluateLocalEmbeddings: false,
      reason:
        'The local hashed lexical reranker provides a measurable quality gain within the latency budget.',
      qualityGain: roundMetric(qualityGain),
      rerankerP95Ratio: roundMetric(p95Ratio),
    };
  }
  return {
    recommendation: 'evaluate-local-embeddings',
    lexicalThresholdsMet: lexicalPass,
    performanceThresholdMet: performancePass,
    keepHashedLexicalReranker: false,
    evaluateLocalEmbeddings: true,
    reason:
      'FTS5/BM25 misses at least one quality or latency threshold and lexical reranking does not close the gap.',
    qualityGain: roundMetric(qualityGain),
    rerankerP95Ratio: roundMetric(p95Ratio),
  };
}

async function runLexical(repositoryValue, query) {
  return repositoryValue.searchDocuments({
    query: query.query,
    ...(query.sourceKey === undefined ? {} : { sourceKey: query.sourceKey }),
    ...(query.language === undefined ? {} : { language: query.language }),
    limit: 10,
  });
}

async function runReranked(reranked, query) {
  return reranked.execute({
    query: query.query,
    ...(query.sourceKey === undefined ? {} : { sourceKey: query.sourceKey }),
    ...(query.language === undefined ? {} : { language: query.language }),
    limit: 10,
    candidateLimit: 40,
  });
}

async function timed(operation) {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

function latencySummary(values) {
  return {
    samples: values.length,
    p50Ms: roundMetric(percentile(values, 0.5), 3),
    p95Ms: roundMetric(percentile(values, 0.95), 3),
    p99Ms: roundMetric(percentile(values, 0.99), 3),
    maxMs: roundMetric(maxValue(values), 3),
  };
}

function maxValue(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);
  return maximum;
}

function roundedSummary(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [
      key,
      typeof value === 'number' ? roundMetric(value) : value,
    ]),
  );
}

function parseTopic(encoded) {
  const separator = encoded.indexOf('|');
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new Error(`Invalid topic definition ${encoded}`);
  }
  const id = encoded.slice(0, separator);
  const title = encoded.slice(separator + 1);
  return { id, title, shortTitle: title.split(' ').slice(0, 5).join(' ') };
}

function documentPublicId(sourceKey, topicId) {
  return `${sourceKey}--${topicId}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function resetCatalog(path) {
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
  mkdirSync(dirname(path), { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseManifest(value) {
  if (!isRecord(value) || !Array.isArray(value.sources) || value.sources.length < 10) {
    throw new Error('Benchmark requires at least 10 sources');
  }
  const defaultSectionsPerDocument = positiveInteger(value.defaultSectionsPerDocument, 100);
  const sources = value.sources.map((source, index) => parseSource(source, index));
  const documentCount = sources.reduce((sum, source) => sum + source.topics.length, 0);
  if (documentCount < 100) throw new Error('Benchmark requires at least 100 documents');
  return { sources, defaultSectionsPerDocument };
}

function parseSource(value, index) {
  if (!isRecord(value)) throw new Error(`Benchmark source ${index} must be an object`);
  const sourceKey = requiredString(value.sourceKey, `source ${index} sourceKey`);
  const displayName = requiredString(value.displayName, `source ${sourceKey} displayName`);
  const baseUrl = requiredString(value.baseUrl, `source ${sourceKey} baseUrl`);
  const language = requiredString(value.language, `source ${sourceKey} language`);
  if (!Array.isArray(value.topics) || value.topics.length === 0) {
    throw new Error(`Benchmark source ${sourceKey} requires topics`);
  }
  const topics = value.topics.map((topic, topicIndex) =>
    requiredString(topic, `source ${sourceKey} topic ${topicIndex}`),
  );
  return { sourceKey, displayName, baseUrl, language, topics };
}

function parseQuerySet(value) {
  if (!isRecord(value) || !Array.isArray(value.queries) || value.queries.length < 50) {
    throw new Error('Benchmark requires at least 50 annotated queries');
  }
  return value.queries.map((query, index) => parseQuery(query, index));
}

function parseQuery(value, index) {
  if (!isRecord(value)) throw new Error(`Benchmark query ${index} must be an object`);
  const id = requiredString(value.id, `query ${index} id`);
  const category = requiredString(value.category, `query ${id} category`);
  const query = requiredString(value.query, `query ${id} text`);
  if (!Array.isArray(value.judgments) || value.judgments.length === 0) {
    throw new Error(`Query ${id} has no relevance judgments`);
  }
  const judgments = value.judgments.map((judgment, judgmentIndex) =>
    parseJudgment(judgment, id, judgmentIndex),
  );
  const sourceKey = optionalString(value.sourceKey, `query ${id} sourceKey`);
  const language = optionalString(value.language, `query ${id} language`);
  return {
    id,
    category,
    query,
    judgments,
    ...(sourceKey === undefined ? {} : { sourceKey }),
    ...(language === undefined ? {} : { language }),
  };
}

function parseJudgment(value, queryId, index) {
  if (!isRecord(value)) throw new Error(`Query ${queryId} judgment ${index} must be an object`);
  const documentPublicId = requiredString(
    value.documentPublicId,
    `query ${queryId} judgment ${index} documentPublicId`,
  );
  const grade = Number(value.grade);
  if (!Number.isSafeInteger(grade) || grade < 1 || grade > 3) {
    throw new Error(`Query ${queryId} judgment ${index} grade must be 1..3`);
  }
  return { documentPublicId, grade };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    const next = argv[index + 1];
    if (
      token === '--path' ||
      token === '--output' ||
      token === '--sections-per-document' ||
      token === '--repetitions' ||
      token === '--warmup-rounds'
    ) {
      if (next === undefined) throw new Error(`Missing value for ${token}`);
      const key = token.slice(2).replace(/-([a-z])/gu, (_, character) => character.toUpperCase());
      result[key] = next;
      index += 1;
    } else {
      throw new Error(`Unknown option ${token}`);
    }
  }
  return result;
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid integer ${value}`);
  return parsed;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
