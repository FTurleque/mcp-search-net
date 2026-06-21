import type { OfficialSource } from '../models/official-source.js';
import type { ProviderSearchResult, SearchResult } from '../models/search.js';

export function toSearchResult(
  result: ProviderSearchResult,
  officialSource: OfficialSource | undefined,
): SearchResult | undefined {
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }

  url.hash = '';
  const baseScore = Number.isFinite(result.score) ? (result.score ?? 0) : 0;
  const officialBoost = officialSource === undefined ? 0 : 1_000 + officialSource.priority;

  return {
    title: result.title.trim() || url.hostname,
    url: url.toString(),
    snippet: result.snippet.trim(),
    source: url.hostname.toLowerCase(),
    official: officialSource !== undefined,
    engines: [...new Set(result.engines)],
    ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
    score: baseScore + officialBoost,
  };
}

export function rankAndDeduplicate(
  results: readonly SearchResult[],
  limit: number,
): readonly SearchResult[] {
  const byUrl = new Map<string, SearchResult>();
  for (const result of results) {
    const key = canonicalResultKey(result.url);
    const previous = byUrl.get(key);
    if (previous === undefined || result.score > previous.score) {
      byUrl.set(key, result);
    }
  }

  return [...byUrl.values()]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

function canonicalResultKey(value: string): string {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname !== '/') {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}
