import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface BenchmarkSource {
  readonly sourceKey: string;
  readonly language: string;
  readonly topics: readonly string[];
}

interface BenchmarkManifest {
  readonly sources: readonly BenchmarkSource[];
}

interface BenchmarkQuery {
  readonly id: string;
  readonly category: string;
  readonly query: string;
  readonly judgments: readonly { readonly documentPublicId: string; readonly grade: number }[];
}

interface BenchmarkQuerySet {
  readonly queries: readonly BenchmarkQuery[];
}

describe('V2.13 search quality benchmark fixtures', () => {
  it('contains at least ten sources, one hundred documents and two languages', () => {
    const manifest = readJson<BenchmarkManifest>('benchmarks/v2-search-quality/corpus-manifest.json');
    const documentCount = manifest.sources.reduce((sum, source) => sum + source.topics.length, 0);

    expect(manifest.sources.length).toBeGreaterThanOrEqual(10);
    expect(documentCount).toBeGreaterThanOrEqual(100);
    expect(new Set(manifest.sources.map((source) => source.language)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(manifest.sources.map((source) => source.sourceKey)).size).toBe(
      manifest.sources.length,
    );
  });

  it('contains fifty annotated queries across every required category', () => {
    const querySet = readJson<BenchmarkQuerySet>('benchmarks/v2-search-quality/queries.json');
    const requiredCategories = new Set([
      'exact-api',
      'concept',
      'configuration',
      'errors',
      'versions',
      'multi-document',
      'paraphrase',
      'filters',
      'accents',
      'identifiers',
    ]);

    expect(querySet.queries).toHaveLength(50);
    expect(new Set(querySet.queries.map((query) => query.id)).size).toBe(50);
    expect(new Set(querySet.queries.map((query) => query.category))).toEqual(requiredCategories);
    for (const query of querySet.queries) {
      expect(query.query.trim().length).toBeGreaterThan(0);
      expect(query.judgments.length).toBeGreaterThan(0);
      expect(query.judgments.every((judgment) => judgment.grade >= 1 && judgment.grade <= 3)).toBe(
        true,
      );
    }
  });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}
