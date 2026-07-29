import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import Database from 'better-sqlite3';
import { z } from 'zod';

import type { Clock } from '../application/ports/clock.js';
import type { ContentFetcher } from '../application/ports/content-fetcher.js';
import {
  measureSearchQueryQuality,
  percentile,
  roundMetric,
  summarizeSearchQuality,
  type SearchQueryQualityMetrics,
  type SearchQualitySummary,
} from '../application/services/search-quality-metrics.js';
import { RerankedSearchCatalogDocuments } from '../application/use-cases/reranked-search-catalog-documents.js';
import { SyncCatalogDocuments } from '../application/use-cases/sync-catalog-documents.js';
import type { CatalogDocumentSearchResult, DocumentSectionInput } from '../domain/models/catalog.js';
import { SqliteCatalogRepository } from '../infrastructure/catalog/sqlite-catalog-repository.js';

const sourceSchema = z.object({
  sourceKey: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  baseUrl: z.string().url(),
  language: z.string().trim().min(1),
  topics: z.array(z.string().trim().min(3)).min(1),
});

const manifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  documentsPerSource: z.number().int().positive(),
  defaultSectionsPerDocument: z.number().int().positive(),
  sources: z.array(sourceSchema).min(10),
});

const judgmentSchema = z.object({
  documentPublicId: z.string().trim().min(1),
  grade: z.number().int().min(1).max(3),
});

const querySchema = z.object({
  id: z.string().trim().min(1),
  category: z.string().trim().min(1),
  query: z.string().trim().min(1),
  sourceKey: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  judgments: z.array(judgmentSchema).min(1),
});

const querySetSchema = z.object({
  schemaVersion: z.literal('1.0'),
  queries: z.array(querySchema).min(50),
});

type BenchmarkManifest = z.infer<typeof manifestSchema>;
type BenchmarkSource = z.infer<typeof sourceSchema>;
type BenchmarkQuery = z.infer<typeof querySchema>;

interface BenchmarkArguments {
  readonly path?: string;
  readonly output?: string;
  readonly sectionsPerDocument?: number;
  readonly repetitions?: number;
  readonly warmupRounds?: number;
}

interface SeedResult {
  readonly documents: number;
  readonly sections: number;
}

interface LatencySummary {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

interface PerformanceResult {
  readonly lexical: LatencySummary;
  readonly reranked: LatencySummary;
}

interface CategoryMetrics {
  readonly lexical: SearchQueryQualityMetrics[];
  readonly reranked: SearchQueryQualityMetrics[];
}

interface CountRow {
  readonly count: number;
}

interface BytesRow {
  readonly bytes: number;
}

const root = resolve(import.meta.dirname, '../..');
const args = parseArguments(process.argv.slice(2));
const manifest = manifestSchema.parse(readJson(resolve(root, 'benchmarks/v2-search-quality/corpus-manifest.json')));
const querySet = querySetSchema.parse(readJson(resolve(root, 'benchmarks/v2-search-quality/queries.json')));
assertCorpusSize(manifest);

const sectionsPerDocument = args.sectionsPerDocument ?? manifest.defaultSectionsPerDocument;
const repetitions = args.repetitions ?? 6;
const warmupRounds = args.warmupRounds ?? 2;
const catalogPath = resolve(root, args.path ?? '.data/benchmark-v2-search-quality.db');
const outputPath = resolve(
  root,
  args.output ?? `docs/planning/benchmark-results/benchmark-v2-search-quality-${today()}.json`,
);
const clock: Clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };

await runBenchmark();

async function runBenchmark(): Promise<void> {
  resetCatalog(catalogPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  const repository = new SqliteCatalogRepository(catalogPath, clock);
  const rerankedSearch = new RerankedSearchCatalogDocuments(repository);

  try {
    const seedStarted = performance.now();
    const seeded = await seedCorpus(repository, manifest, sectionsPerDocument);
    const seedDurationMs = performance.now() - seedStarted;

    const rebuildStarted = performance.now();
    const rebuild = await repository.rebuildSearchIndex();
    const rebuildDurationMs = performance.now() - rebuildStarted;

    await warmup(querySet.queries, repository, rerankedSearch, warmupRounds);
    const quality = await measureQuality(querySet.queries, repository, rerankedSearch);
    const performanceResult = await measurePerformance(
      querySet.queries,
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
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
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
        queryCount: querySet.queries.length,
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

    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(outputPath, serialized, 'utf8');
    process.stdout.write(serialized);
    process.stderr.write(`Benchmark written to ${outputPath}\n`);
  } finally {
    repository.close();
  }
}

async function seedCorpus(
  repository: SqliteCatalogRepository,
  benchmarkManifest: BenchmarkManifest,
  sectionCount: number,
): Promise<SeedResult> {
  let documents = 0;
  let sections = 0;
  for (const sourceDefinition of benchmarkManifest.sources) {
    const source = await repository.addSource({
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
      const generatedSections = Array.from({ length: sectionCount }, (_, index) =>
        createSection(sourceDefinition, topic, index),
      );
      const combined = generatedSections.map((section) => section.content).join('\n');
      await repository.commitDocumentRevision({
        document: {
          publicId: `${sourceDefinition.sourceKey}--${topic.id}`,
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

function createSection(
  source: BenchmarkSource,
  topic: ReturnType<typeof parseTopic>,
  zeroBasedIndex: number,
): DocumentSectionInput {
  const ordinal = zeroBasedIndex + 1;
  const versionHint = source.sourceKey === 'nodejs' || source.sourceKey === 'openjdk' ? '24' : 'current';
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

async function warmup(
  queries: readonly BenchmarkQuery[],
  repository: SqliteCatalogRepository,
  reranked: RerankedSearchCatalogDocuments,
  rounds: number,
): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    for (const query of queries) {
      await runLexical(repository, query);
      await runReranked(reranked, query);
    }
  }
}

async function measureQuality(
  queries: readonly BenchmarkQuery[],
  repository: SqliteCatalogRepository,
  reranked: RerankedSearchCatalogDocuments,
) {
  const lexicalCases: SearchQueryQualityMetrics[] = [];
  const rerankedCases: SearchQueryQualityMetrics[] = [];
  const failures: object[] = [];
  const categories = new Map<string, CategoryMetrics>();

  for (const query of queries) {
    const lexical = await runLexical(repository, query);
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

async function measurePerformance(
  queries: readonly BenchmarkQuery[],
  repository: SqliteCatalogRepository,
  reranked: RerankedSearchCatalogDocuments,
  repeatCount: number,
): Promise<PerformanceResult> {
  const lexicalDurations: number[] = [];
  const rerankedDurations: number[] = [];
  for (let repetition = 0; repetition < repeatCount; repetition += 1) {
    for (const [queryIndex, query] of queries.entries()) {
      if ((repetition + queryIndex) % 2 === 0) {
        lexicalDurations.push(await timed(() => runLexical(repository, query)));
        rerankedDurations.push(await timed(() => runReranked(reranked, query)));
      } else {
        rerankedDurations.push(await timed(() => runReranked(reranked, query)));
        lexicalDurations.push(await timed(() => runLexical(repository, query)));
      }
    }
  }
  return { lexical: latencySummary(lexicalDurations), reranked: latencySummary(rerankedDurations) };
}

async function measureIncrementalSync(
  repository: SqliteCatalogRepository,
  benchmarkManifest: BenchmarkManifest,
  benchmarkClock: Clock,
): Promise<number> {
  const source = benchmarkManifest.sources[0];
  if (source === undefined) throw new Error('Benchmark requires at least one source');

  const stableKey = 'benchmark-incremental-sync';
  let revision = 1;
  const fetcher: ContentFetcher = {
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
        fetchedAt: benchmarkClock.now().toISOString(),
        extractionMode: 'static',
        statusCode: 200,
        contentHash: sha256(markdown),
        metadata: { benchmark: 'v2.13' },
        links: [],
      };
    },
  };
  const sync = new SyncCatalogDocuments(repository, fetcher, benchmarkClock, async () => undefined);
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
  } as const;

  const initial = await sync.execute(options);
  if (initial.addedCount !== 1) throw new Error(`Expected one initial sync insert, got ${initial.addedCount}`);

  revision = 2;
  const started = performance.now();
  const updated = await sync.execute(options);
  const duration = performance.now() - started;
  if (updated.updatedCount !== 1) throw new Error(`Expected one incremental update, got ${updated.updatedCount}`);
  return duration;
}

function measureStorage(path: string) {
  let ftsBytes: number | null = null;
  const database = new Database(path, { readonly: true });
  try {
    try {
      const row = database
        .prepare<[], BytesRow>(
          "SELECT coalesce(sum(pgsize), 0) AS bytes FROM dbstat WHERE name LIKE 'document_section_fts%'",
        )
        .get();
      ftsBytes = row?.bytes ?? 0;
    } catch {
      ftsBytes = null;
    }
    const indexed = database.prepare<[], CountRow>('SELECT count(*) AS count FROM document_section_fts').get();
    return {
      catalogBytes: statSync(path).size,
      ftsBytes,
      indexedSections: indexed?.count ?? 0,
    };
  } finally {
    database.close();
  }
}

function decideStrategy(
  quality: { readonly lexical: SearchQualitySummary; readonly reranked: SearchQualitySummary },
  performanceResult: PerformanceResult,
  sectionCount: number,
) {
  const lexical = quality.lexical;
  const reranked = quality.reranked;
  const lexicalPass = lexical.recallAt10 >= 0.85 && lexical.mrrAt10 >= 0.7 && lexical.ndcgAt10 >= 0.75;
  const performancePass = sectionCount < 10_000 || performanceResult.lexical.p95Ms <= 150;
  const qualityGain = Math.max(
    reranked.recallAt10 - lexical.recallAt10,
    reranked.ndcgAt10 - lexical.ndcgAt10,
  );
  const p95Ratio = performanceResult.lexical.p95Ms === 0
    ? 1
    : performanceResult.reranked.p95Ms / performanceResult.lexical.p95Ms;
  const rerankerEarnsKeep = qualityGain >= 0.02 && performanceResult.reranked.p95Ms <= 150 && p95Ratio <= 2.5;

  if (lexicalPass && performancePass && !rerankerEarnsKeep) {
    return {
      recommendation: 'fts5-bm25',
      lexicalThresholdsMet: true,
      performanceThresholdMet: true,
      keepHashedLexicalReranker: false,
      evaluateLocalEmbeddings: false,
      reason: 'FTS5/BM25 meets quality and latency thresholds and the hashed lexical reranker does not earn its complexity.',
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
      reason: 'The local hashed lexical reranker provides a measurable quality gain within the latency budget.',
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
    reason: 'FTS5/BM25 misses at least one quality or latency threshold and lexical reranking does not close the gap.',
    qualityGain: roundMetric(qualityGain),
    rerankerP95Ratio: roundMetric(p95Ratio),
  };
}

function runLexical(
  repository: SqliteCatalogRepository,
  query: BenchmarkQuery,
): Promise<readonly CatalogDocumentSearchResult[]> {
  return repository.searchDocuments({
    query: query.query,
    ...(query.sourceKey === undefined ? {} : { sourceKey: query.sourceKey }),
    ...(query.language === undefined ? {} : { language: query.language }),
    limit: 10,
  });
}

function runReranked(reranked: RerankedSearchCatalogDocuments, query: BenchmarkQuery) {
  return reranked.execute({
    query: query.query,
    ...(query.sourceKey === undefined ? {} : { sourceKey: query.sourceKey }),
    ...(query.language === undefined ? {} : { language: query.language }),
    limit: 10,
    candidateLimit: 40,
  });
}

async function timed(operation: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

function latencySummary(values: readonly number[]): LatencySummary {
  return {
    samples: values.length,
    p50Ms: roundMetric(percentile(values, 0.5), 3),
    p95Ms: roundMetric(percentile(values, 0.95), 3),
    p99Ms: roundMetric(percentile(values, 0.99), 3),
    maxMs: roundMetric(maxValue(values), 3),
  };
}

function maxValue(values: readonly number[]): number {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);
  return maximum;
}

function roundedSummary(summary: SearchQualitySummary): SearchQualitySummary {
  return {
    queryCount: summary.queryCount,
    mrrAt10: roundMetric(summary.mrrAt10),
    ndcgAt10: roundMetric(summary.ndcgAt10),
    recallAt10: roundMetric(summary.recallAt10),
    precisionAt5: roundMetric(summary.precisionAt5),
    zeroResultRate: roundMetric(summary.zeroResultRate),
  };
}

function parseTopic(encoded: string): { readonly id: string; readonly title: string; readonly shortTitle: string } {
  const separator = encoded.indexOf('|');
  if (separator <= 0 || separator === encoded.length - 1) throw new Error(`Invalid topic definition ${encoded}`);
  const id = encoded.slice(0, separator);
  const title = encoded.slice(separator + 1);
  return { id, title, shortTitle: title.split(' ').slice(0, 5).join(' ') };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function resetCatalog(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
  mkdirSync(dirname(path), { recursive: true });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function assertCorpusSize(benchmarkManifest: BenchmarkManifest): void {
  const documentCount = benchmarkManifest.sources.reduce((sum, source) => sum + source.topics.length, 0);
  if (documentCount < 100) throw new Error('Benchmark requires at least 100 documents');
}

function parseArguments(argv: readonly string[]): BenchmarkArguments {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    const next = argv[index + 1];
    if (!isKnownOption(token)) throw new Error(`Unknown option ${token}`);
    if (next === undefined) throw new Error(`Missing value for ${token}`);
    result[token] = next;
    index += 1;
  }
  return {
    path: result['--path'],
    output: result['--output'],
    sectionsPerDocument: parsePositiveInteger(result['--sections-per-document']),
    repetitions: parsePositiveInteger(result['--repetitions']),
    warmupRounds: parsePositiveInteger(result['--warmup-rounds']),
  };
}

function isKnownOption(value: string): boolean {
  return value === '--path' || value === '--output' || value === '--sections-per-document' || value === '--repetitions' || value === '--warmup-rounds';
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`Invalid positive integer ${value}`);
  }
  return parsed;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
