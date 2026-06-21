import type { OfficialSource } from '../models/official-source.js';
import type { ProviderSearchResult, SearchResult, SourceStatus } from '../models/search.js';

const TRACKING_PARAMETERS = new Set([
  'dclid',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  '_hsenc',
  '_hsmi',
]);
const THIRD_PARTY_DOMAINS = [
  'dev.to',
  'medium.com',
  'quora.com',
  'reddit.com',
  'serverfault.com',
  'stackexchange.com',
  'stackoverflow.com',
  'superuser.com',
];
const DOCUMENTATION_LABELS = new Set([
  'api',
  'developer',
  'developers',
  'docs',
  'documentation',
  'learn',
  'reference',
  'support',
]);

export interface SearchResultContext {
  readonly query: string;
  readonly officialSource?: OfficialSource;
  readonly allowedDomains: readonly string[];
}

export function toSearchResult(
  result: ProviderSearchResult,
  context: SearchResultContext,
): SearchResult | undefined {
  const normalizedUrl = normalizeResultUrl(result.url);
  if (normalizedUrl === undefined) return undefined;

  const url = new URL(normalizedUrl);
  const domain = url.hostname.toLowerCase();
  const sourceStatus = classifySource(url, context.officialSource, context.allowedDomains);
  const title = result.title.trim() || domain;

  return {
    title,
    url: normalizedUrl,
    domain,
    snippet: result.snippet.trim(),
    sourceStatus,
    engines: [...new Set(result.engines)].sort(compareText),
    ...(result.publishedAt === undefined ? {} : { publishedAt: result.publishedAt }),
    ...(result.updatedAt === undefined ? {} : { updatedAt: result.updatedAt }),
    ...(result.detectedLanguage === undefined ? {} : { detectedLanguage: result.detectedLanguage }),
    score: scoreResult(result, title, url, sourceStatus, context),
  };
}

export function rankAndDeduplicate(results: readonly SearchResult[]): readonly SearchResult[] {
  const byUrl = new Map<string, SearchResult>();
  for (const result of results) {
    const previous = byUrl.get(result.url);
    if (previous === undefined || compareResults(result, previous) < 0) {
      byUrl.set(result.url, result);
    }
  }
  return [...byUrl.values()].sort(compareResults);
}

export function normalizeResultUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.startsWith('utm_') || TRACKING_PARAMETERS.has(normalizedKey)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString();
}

export function matchesDomain(hostname: string, domains: readonly string[]): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function classifySource(
  url: URL,
  officialSource: OfficialSource | undefined,
  allowedDomains: readonly string[],
): SourceStatus {
  if (officialSource !== undefined || matchesDomain(url.hostname, allowedDomains)) {
    return 'VERIFIED_OFFICIAL';
  }
  if (matchesDomain(url.hostname, THIRD_PARTY_DOMAINS) || looksThirdParty(url)) {
    return 'THIRD_PARTY';
  }
  if (looksLikeDocumentation(url)) return 'LIKELY_OFFICIAL';
  return 'UNKNOWN';
}

function scoreResult(
  result: ProviderSearchResult,
  title: string,
  url: URL,
  sourceStatus: SourceStatus,
  context: SearchResultContext,
): number {
  const providerScore = Number.isFinite(result.score) ? Math.max(0, result.score ?? 0) : 0;
  const providerSignal = providerScore / (providerScore + 10);
  const sourceSignal: Readonly<Record<SourceStatus, number>> = {
    VERIFIED_OFFICIAL: 0.5,
    LIKELY_OFFICIAL: 0.28,
    THIRD_PARTY: -0.08,
    UNKNOWN: 0,
  };
  const terms = tokenize(context.query);
  const titleTokens = new Set(tokenize(title));
  const urlText = `${url.hostname} ${url.pathname}`.toLowerCase();
  const titleMatches = terms.filter((term) => titleTokens.has(term)).length;
  const urlMatches = terms.filter((term) => urlText.includes(term)).length;
  const titleSignal = terms.length === 0 ? 0 : (titleMatches / terms.length) * 0.15;
  const urlSignal = terms.length === 0 ? 0 : (urlMatches / terms.length) * 0.05;
  const documentationBonus = looksLikeDocumentation(url) ? 0.05 : 0;
  const officialPriority = Math.min(context.officialSource?.priority ?? 0, 1_000) / 1_000;
  const raw =
    0.12 +
    providerSignal * 0.12 +
    sourceSignal[sourceStatus] +
    titleSignal +
    urlSignal +
    documentationBonus +
    officialPriority * 0.05;
  return Number(Math.min(1, Math.max(0, raw)).toFixed(6));
}

function looksThirdParty(url: URL): boolean {
  const labels = url.hostname.toLowerCase().split('.');
  const segments = url.pathname.toLowerCase().split('/');
  return (
    labels.some((label) => label === 'blog' || label === 'community' || label === 'forum') ||
    segments.some((segment) => segment === 'blog' || segment === 'community' || segment === 'forum')
  );
}

function looksLikeDocumentation(url: URL): boolean {
  const labels = url.hostname.toLowerCase().split('.');
  const segments = url.pathname.toLowerCase().split('/');
  return [...labels, ...segments].some((part) => DOCUMENTATION_LABELS.has(part));
}

function tokenize(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[\u0300-\u036f]/gu, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2),
    ),
  ];
}

function compareResults(left: SearchResult, right: SearchResult): number {
  if (left.score !== right.score) return right.score - left.score;
  const title = compareText(left.title.toLowerCase(), right.title.toLowerCase());
  if (title !== 0) return title;
  return compareText(left.url, right.url);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
