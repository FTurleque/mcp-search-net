import type Database from 'better-sqlite3';

import type {
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
} from '../../domain/models/catalog.js';
import { truncateUnicode } from '../../domain/services/bounded-text.js';
import {
  SEARCH_CURRENT_DOCUMENT_SECTIONS_FTS_SQL,
  SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL,
} from './catalog-sql.js';
import type { CatalogDocumentSearchRow } from './sqlite-catalog-row-views.js';
import { toCatalogCurrentDocumentSection } from './sqlite-catalog-row-views.js';

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_SNIPPET_RADIUS = 80;
const MAX_SNIPPET_TERMS = 32;
const MAX_SNIPPET_OCCURRENCES_PER_TERM = 16;

type SearchCurrentDocumentSectionsParams = [
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
  string,
  string,
  string,
  number,
];

type SearchCurrentDocumentSectionsFtsParams = [
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  number,
];

export class SqliteCatalogSearch {
  public constructor(private readonly database: Database.Database) {}

  public search(query: CatalogDocumentSearchQuery): readonly CatalogDocumentSearchResult[] {
    const term = query.query.trim().toLocaleLowerCase();
    if (term.length === 0) return [];

    const pattern = `%${escapeLikePattern(term)}%`;
    const sourceKey = query.sourceKey ?? null;
    const language = query.language ?? null;
    const limit = normalizeSearchLimit(query.limit);
    const ftsQuery = createFtsQuery(term);
    const ftsRows =
      ftsQuery === undefined
        ? []
        : this.searchWithFts(ftsQuery, pattern, sourceKey, language, limit);
    const rows =
      ftsRows.length > 0 ? ftsRows : this.searchWithLike(pattern, sourceKey, language, limit);

    return rows.map((row) => ({
      ...toCatalogCurrentDocumentSection(row),
      snippet: createSnippet(row.section_content, term),
      score: row.score,
    }));
  }

  private searchWithFts(
    ftsQuery: string,
    pattern: string,
    sourceKey: string | null,
    language: string | null,
    limit: number,
  ): readonly CatalogDocumentSearchRow[] {
    return this.database
      .prepare<
        SearchCurrentDocumentSectionsFtsParams,
        CatalogDocumentSearchRow
      >(SEARCH_CURRENT_DOCUMENT_SECTIONS_FTS_SQL)
      .all(pattern, pattern, pattern, ftsQuery, sourceKey, sourceKey, language, language, limit);
  }

  private searchWithLike(
    pattern: string,
    sourceKey: string | null,
    language: string | null,
    limit: number,
  ): readonly CatalogDocumentSearchRow[] {
    return this.database
      .prepare<
        SearchCurrentDocumentSectionsParams,
        CatalogDocumentSearchRow
      >(SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL)
      .all(
        pattern,
        pattern,
        pattern,
        sourceKey,
        sourceKey,
        language,
        language,
        pattern,
        pattern,
        pattern,
        pattern,
        limit,
      );
  }
}

function normalizeSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

function escapeLikePattern(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);
}

function createFtsQuery(value: string): string | undefined {
  const terms = value
    .split(/\s+/u)
    .map((term) => term.replaceAll('"', '').trim())
    .filter((term) => term.length > 0);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

function createSnippet(content: string, term: string): string {
  const snippetLength = SEARCH_SNIPPET_RADIUS * 2;
  const requestedStart = findBestMultiTermSnippetStart(content, term, snippetLength);
  const start = previousUnicodeBoundary(content, requestedStart);
  const end = previousUnicodeBoundary(content, Math.min(content.length, start + snippetLength * 2));
  const prefix = start > 0 ? '…' : '';
  const raw = content.slice(start, end).trim();
  const body = truncateUnicode(raw, snippetLength);
  const suffix = end < content.length && !body.endsWith('…') ? '…' : '';
  return `${prefix}${body}${suffix}`;
}

function previousUnicodeBoundary(value: string, index: number): number {
  const bounded = Math.min(Math.max(index, 0), value.length);
  if (bounded <= 0 || bounded >= value.length) return bounded;
  const current = value.charCodeAt(bounded);
  const previous = value.charCodeAt(bounded - 1);
  return current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
    ? bounded - 1
    : bounded;
}

function findBestMultiTermSnippetStart(
  content: string,
  query: string,
  snippetLength: number,
): number {
  const normalizedContent = normalizeSnippetText(content);
  const terms = extractSnippetTerms(query);
  if (terms.length === 0) return 0;

  const occurrences = collectSnippetOccurrences(normalizedContent, terms);
  if (occurrences.length === 0) return 0;
  return selectBestSnippetStart(occurrences, content.length, snippetLength);
}

function collectSnippetOccurrences(
  normalizedContent: NormalizedSnippetText,
  terms: readonly string[],
): SnippetOccurrence[] {
  const termIndexes = new Map(terms.map((candidate, index) => [candidate, index] as const));
  const occurrenceCounts = new Array<number>(terms.length).fill(0);
  const occurrences: SnippetOccurrence[] = [];
  for (const match of normalizedContent.value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const matchedToken = match[0];
    const termIndex = termIndexes.get(matchedToken);
    if (termIndex === undefined) continue;
    if ((occurrenceCounts[termIndex] ?? 0) >= MAX_SNIPPET_OCCURRENCES_PER_TERM) continue;
    const normalizedStart = match.index;
    const normalizedEnd = normalizedStart + matchedToken.length;
    const originalStart = normalizedContent.originalStarts[normalizedStart];
    const originalEnd = normalizedContent.originalEnds[normalizedEnd - 1];
    if (originalStart === undefined || originalEnd === undefined) continue;
    occurrences.push({ termIndex, originalStart, originalEnd });
    occurrenceCounts[termIndex] = (occurrenceCounts[termIndex] ?? 0) + 1;
  }
  return occurrences;
}

function selectBestSnippetStart(
  occurrences: readonly SnippetOccurrence[],
  contentLength: number,
  snippetLength: number,
): number {
  let best: SnippetWindowScore | undefined;
  for (const anchor of occurrences) {
    const start = snippetWindowStart(anchor.originalStart, contentLength, snippetLength);
    const end = Math.min(contentLength, start + snippetLength);
    const candidate = scoreSnippetWindow(occurrences, start, end);
    if (isBetterSnippetWindow(candidate, best)) best = candidate;
  }
  return best?.start ?? 0;
}

function scoreSnippetWindow(
  occurrences: readonly SnippetOccurrence[],
  start: number,
  end: number,
): SnippetWindowScore {
  const matchedTermIndexes = new Set<number>();
  let firstMatch = end;
  let lastMatch = start;
  for (const occurrence of occurrences) {
    if (occurrence.originalStart < start || occurrence.originalStart >= end) continue;
    matchedTermIndexes.add(occurrence.termIndex);
    firstMatch = Math.min(firstMatch, occurrence.originalStart);
    lastMatch = Math.max(lastMatch, Math.min(end, occurrence.originalEnd));
  }
  const matchedTerms = matchedTermIndexes.size;
  return {
    start,
    matchedTerms,
    span: matchedTerms === 0 ? Number.POSITIVE_INFINITY : lastMatch - firstMatch,
  };
}

function isBetterSnippetWindow(
  candidate: SnippetWindowScore,
  best: SnippetWindowScore | undefined,
): boolean {
  if (best === undefined) return true;
  if (candidate.matchedTerms !== best.matchedTerms) {
    return candidate.matchedTerms > best.matchedTerms;
  }
  if (candidate.span !== best.span) return candidate.span < best.span;
  return candidate.start < best.start;
}

interface NormalizedSnippetText {
  readonly value: string;
  readonly originalStarts: readonly number[];
  readonly originalEnds: readonly number[];
}

interface SnippetOccurrence {
  readonly termIndex: number;
  readonly originalStart: number;
  readonly originalEnd: number;
}

interface SnippetWindowScore {
  readonly start: number;
  readonly matchedTerms: number;
  readonly span: number;
}

function normalizeSnippetText(value: string): NormalizedSnippetText {
  let normalizedValue = '';
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  let originalStart = 0;

  for (const character of value) {
    const originalEnd = originalStart + character.length;
    const normalizedCharacter = character.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '');
    normalizedValue += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      originalStarts.push(originalStart);
      originalEnds.push(originalEnd);
    }
    originalStart = originalEnd;
  }

  return { value: normalizedValue, originalStarts, originalEnds };
}

function extractSnippetTerms(query: string): readonly string[] {
  const normalizedQuery = normalizeSnippetText(query).value;
  const terms = new Set<string>();
  for (const match of normalizedQuery.matchAll(/[\p{L}\p{N}]+/gu)) {
    terms.add(match[0]);
    if (terms.size >= MAX_SNIPPET_TERMS) break;
  }
  return [...terms];
}

function snippetWindowStart(
  position: number,
  contentLength: number,
  snippetLength: number,
): number {
  return Math.min(
    Math.max(0, position - SEARCH_SNIPPET_RADIUS),
    Math.max(0, contentLength - snippetLength),
  );
}
