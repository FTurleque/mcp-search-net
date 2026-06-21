import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';
import type {
  NormalizedSearchRequest,
  SearchRequest,
  SearchTimeRange,
  SourcePolicy,
} from '../../domain/models/search.js';
import { containsControlCharacters } from '../../domain/services/text-validation.js';

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SOURCE_POLICIES: readonly SourcePolicy[] = ['strict', 'prefer', 'any'];
const TIME_RANGES: readonly SearchTimeRange[] = ['day', 'week', 'month', 'year'];

export function normalizeSearchRequest(request: SearchRequest): NormalizedSearchRequest {
  if (containsControlCharacters(request.query)) {
    throw new InvalidArgumentError('The search query contains control characters');
  }
  const query = request.query.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (query.length < 2 || query.length > 500) {
    throw new InvalidArgumentError('The search query must contain between 2 and 500 characters');
  }
  if (!Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 10) {
    throw new InvalidArgumentError('maxResults must be an integer between 1 and 10');
  }

  const sourcePolicy = request.sourcePolicy ?? 'prefer';
  if (!SOURCE_POLICIES.includes(sourcePolicy)) {
    throw new InvalidArgumentError('sourcePolicy must be strict, prefer or any');
  }
  if (request.timeRange !== undefined && !TIME_RANGES.includes(request.timeRange)) {
    throw new InvalidArgumentError('timeRange must be day, week, month or year');
  }

  return {
    query,
    language: normalizeLanguage(request.language ?? 'fr-FR'),
    ...(request.timeRange === undefined ? {} : { timeRange: request.timeRange }),
    maxResults: request.maxResults,
    sourcePolicy,
    allowedDomains: normalizeDomains(request.allowedDomains ?? [], 'allowedDomains'),
    excludedDomains: normalizeDomains(request.excludedDomains ?? [], 'excludedDomains'),
  };
}

export function createSearchCacheKey(
  request: NormalizedSearchRequest,
  officialSourcesVersion: string,
  behavior: {
    readonly providerOversampling: number;
    readonly maxSnippetChars: number;
  },
): string {
  const material = {
    query: request.query.toLowerCase(),
    language: request.language,
    timeRange: request.timeRange ?? null,
    maxResults: request.maxResults,
    sourcePolicy: request.sourcePolicy,
    allowedDomains: request.allowedDomains,
    excludedDomains: request.excludedDomains,
    officialSourcesVersion,
    providerOversampling: behavior.providerOversampling,
    maxSnippetChars: behavior.maxSnippetChars,
    contractVersion: 2,
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export function normalizeDomain(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/\.$/u, '');
  if (candidate === '' || /[\s/:@?#]/u.test(candidate)) {
    throw new InvalidArgumentError(`Invalid domain: ${value}`);
  }
  const ascii = domainToASCII(candidate);
  if (ascii === '' || ascii.length > 253) {
    throw new InvalidArgumentError(`Invalid domain: ${value}`);
  }
  const labels = ascii.split('.');
  if (labels.some((label) => !DOMAIN_LABEL.test(label))) {
    throw new InvalidArgumentError(`Invalid domain: ${value}`);
  }
  return ascii;
}

export function domainMatches(hostname: string, domain: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

function normalizeDomains(values: readonly string[], field: string): readonly string[] {
  if (values.length > 20) {
    throw new InvalidArgumentError(`${field} cannot contain more than 20 domains`);
  }
  return [...new Set(values.map(normalizeDomain))].sort(compareText);
}

function normalizeLanguage(value: string): string {
  try {
    const language = Intl.getCanonicalLocales(value.trim())[0];
    if (language === undefined) throw new Error('missing locale');
    return language;
  } catch (error) {
    throw new InvalidArgumentError(`Invalid language: ${value}`, { cause: error });
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
