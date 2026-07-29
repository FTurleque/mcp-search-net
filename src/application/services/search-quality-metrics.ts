export interface SearchRelevanceJudgment {
  readonly documentPublicId: string;
  readonly grade: number;
}

export interface SearchQueryQualityMetrics {
  readonly reciprocalRankAt10: number;
  readonly ndcgAt10: number;
  readonly recallAt10: number;
  readonly precisionAt5: number;
  readonly zeroResult: boolean;
}

export interface SearchQualitySummary {
  readonly queryCount: number;
  readonly mrrAt10: number;
  readonly ndcgAt10: number;
  readonly recallAt10: number;
  readonly precisionAt5: number;
  readonly zeroResultRate: number;
}

export function measureSearchQueryQuality(
  rankedDocumentPublicIds: readonly string[],
  judgments: readonly SearchRelevanceJudgment[],
): SearchQueryQualityMetrics {
  const grades = new Map(
    judgments.filter((judgment) => judgment.grade > 0).map((judgment) => [judgment.documentPublicId, judgment.grade]),
  );
  const top10 = unique(rankedDocumentPublicIds).slice(0, 10);
  const top5 = top10.slice(0, 5);
  const relevantIds = new Set(grades.keys());
  const firstRelevantIndex = top10.findIndex((id) => relevantIds.has(id));
  const retrievedRelevantAt10 = top10.filter((id) => relevantIds.has(id)).length;
  const retrievedRelevantAt5 = top5.filter((id) => relevantIds.has(id)).length;

  return {
    reciprocalRankAt10: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAt10: ndcg(top10, grades, 10),
    recallAt10: relevantIds.size === 0 ? 1 : retrievedRelevantAt10 / relevantIds.size,
    precisionAt5: retrievedRelevantAt5 / 5,
    zeroResult: rankedDocumentPublicIds.length === 0,
  };
}

export function summarizeSearchQuality(
  cases: readonly SearchQueryQualityMetrics[],
): SearchQualitySummary {
  return {
    queryCount: cases.length,
    mrrAt10: average(cases.map((entry) => entry.reciprocalRankAt10)),
    ndcgAt10: average(cases.map((entry) => entry.ndcgAt10)),
    recallAt10: average(cases.map((entry) => entry.recallAt10)),
    precisionAt5: average(cases.map((entry) => entry.precisionAt5)),
    zeroResultRate: cases.length === 0 ? 0 : cases.filter((entry) => entry.zeroResult).length / cases.length,
  };
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error('Percentile fraction must be between 0 and 1');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function roundMetric(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ndcg(
  rankedDocumentPublicIds: readonly string[],
  grades: ReadonlyMap<string, number>,
  limit: number,
): number {
  const actual = rankedDocumentPublicIds.slice(0, limit).map((id) => grades.get(id) ?? 0);
  const ideal = [...grades.values()].sort((left, right) => right - left).slice(0, limit);
  const idealDcg = dcg(ideal);
  return idealDcg === 0 ? 1 : dcg(actual) / idealDcg;
}

function dcg(grades: readonly number[]): number {
  return grades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
