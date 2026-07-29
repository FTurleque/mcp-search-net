import { describe, expect, it } from 'vitest';

import {
  measureSearchQueryQuality,
  percentile,
  summarizeSearchQuality,
} from '../../src/application/services/search-quality-metrics.js';

describe('search quality metrics', () => {
  it('computes MRR, nDCG, recall and precision from graded judgments', () => {
    const metrics = measureSearchQueryQuality(
      ['irrelevant', 'relevant-b', 'relevant-a'],
      [
        { documentPublicId: 'relevant-a', grade: 3 },
        { documentPublicId: 'relevant-b', grade: 2 },
      ],
    );

    expect(metrics.reciprocalRankAt10).toBe(0.5);
    expect(metrics.recallAt10).toBe(1);
    expect(metrics.precisionAt5).toBe(0.4);
    expect(metrics.ndcgAt10).toBeGreaterThan(0);
    expect(metrics.ndcgAt10).toBeLessThan(1);
    expect(metrics.zeroResult).toBe(false);
  });

  it('summarizes query metrics and reports zero results explicitly', () => {
    const empty = measureSearchQueryQuality([], [{ documentPublicId: 'expected', grade: 3 }]);
    const hit = measureSearchQueryQuality(
      ['expected'],
      [{ documentPublicId: 'expected', grade: 3 }],
    );
    const summary = summarizeSearchQuality([empty, hit]);

    expect(summary.queryCount).toBe(2);
    expect(summary.mrrAt10).toBe(0.5);
    expect(summary.recallAt10).toBe(0.5);
    expect(summary.zeroResultRate).toBe(0.5);
  });

  it('uses nearest-rank percentiles for deterministic latency reporting', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(() => percentile([1], 1.1)).toThrow('Percentile fraction must be between 0 and 1');
  });
});
