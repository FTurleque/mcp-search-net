#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const catalogPath = resolve(args.path ?? process.env.MCP_CATALOG_PATH ?? '.data/catalog-spike.db');
const outputPath = resolve(
  args.output ?? `docs/planning/benchmark-results/benchmark-v2-hybrid-${today()}.json`,
);
const limit = parseIntOption(args.limit, 10);
const queries =
  args.query.length > 0
    ? args.query
    : [
        'resources MCP V2',
        'catalog sync rate limit',
        'maintenance SQLite catalog',
        'IntelliJ Copilot MCP configuration',
        'document versions current version',
      ];

if (!existsSync(catalogPath)) {
  throw new Error(`Catalog not found: ${catalogPath}`);
}

mkdirSync(dirname(outputPath), { recursive: true });

const startedAt = new Date().toISOString();
const cases = queries.map((query) => compareQuery(query, limit));
const report = {
  schemaVersion: '1.0',
  startedAt,
  finishedAt: new Date().toISOString(),
  catalogPath,
  limit,
  summary: summarize(cases),
  cases,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`Benchmark written to ${outputPath}\n`);

function compareQuery(query, limitValue) {
  const lexical = runJsonCommand('lexical', [
    'node',
    'build/cli/catalog.js',
    'search',
    '--path',
    catalogPath,
    '--query',
    query,
    '--limit',
    String(limitValue),
  ]);
  const hybrid = runJsonCommand('hybrid', [
    'node',
    'build/cli/catalog-hybrid-search.js',
    '--path',
    catalogPath,
    '--query',
    query,
    '--limit',
    String(limitValue),
  ]);
  return {
    query,
    lexical: toComparableResult(lexical),
    hybrid: toComparableResult(hybrid),
    overlap: overlapTopResults(lexical.json, hybrid.json),
  };
}

function runJsonCommand(strategy, command) {
  const started = performance.now();
  const result = spawnSync(command[0], command.slice(1), {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  if (result.status !== 0) {
    throw new Error(`${strategy} command failed with ${result.status}: ${result.stderr}`);
  }
  return {
    strategy,
    durationMs,
    json: JSON.parse(result.stdout),
  };
}

function toComparableResult(run) {
  return {
    durationMs: run.durationMs,
    resultCount: run.json.resultCount ?? 0,
    top: getResults(run.json)
      .slice(0, 3)
      .map((result) => ({
        title: result.title,
        documentPublicId: result.documentPublicId,
        heading: result.heading ?? result.headingPath ?? null,
        score: result.score ?? result.hybridScore ?? null,
      })),
  };
}

function getResults(json) {
  return Array.isArray(json.results) ? json.results : [];
}

function overlapTopResults(leftJson, rightJson) {
  const left = new Set(getResults(leftJson).slice(0, 5).map(resultKey));
  const right = new Set(getResults(rightJson).slice(0, 5).map(resultKey));
  let common = 0;
  for (const key of left) {
    if (right.has(key)) common += 1;
  }
  return {
    top5Common: common,
    top5Ratio: left.size === 0 ? 0 : common / left.size,
  };
}

function resultKey(result) {
  return `${result.documentPublicId ?? result.title}:${result.heading ?? result.headingPath ?? ''}`;
}

function summarize(casesValue) {
  const lexicalDurations = casesValue.map((entry) => entry.lexical.durationMs);
  const hybridDurations = casesValue.map((entry) => entry.hybrid.durationMs);
  const overlap = casesValue.map((entry) => entry.overlap.top5Ratio);
  return {
    queryCount: casesValue.length,
    lexicalAverageMs: average(lexicalDurations),
    hybridAverageMs: average(hybridDurations),
    averageTop5Overlap: average(overlap),
  };
}

function average(values) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function parseArgs(argv) {
  const options = { query: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--query') {
      if (next === undefined) throw new Error('Missing value for --query');
      options.query.push(next);
      index += 1;
    } else if (token === '--path' || token === '--output' || token === '--limit') {
      if (next === undefined) throw new Error(`Missing value for ${token}`);
      options[token.slice(2)] = next;
      index += 1;
    } else {
      throw new Error(`Unknown option ${token}`);
    }
  }
  return options;
}

function parseIntOption(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid integer ${value}`);
  return parsed;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
