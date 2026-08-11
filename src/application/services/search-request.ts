import { createHash } from 'node:crypto';
import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';
import type {
  NormalizedSearchRequest,
  SearchRequest,
  SearchTimeRange,
  SourcePolicy,
} from '../../domain/models/search.js';
import { DomainName } from '../../domain/value-objects/domain-name.js';
import { SearchQuery } from '../../domain/value-objects/search-query.js';
const SOURCE_POLICIES: readonly SourcePolicy[] = ['strict', 'prefer', 'any'];
const TIME_RANGES: readonly SearchTimeRange[] = ['day', 'month', 'year'];

export function normalizeSearchRequest(request: SearchRequest): NormalizedSearchRequest {
  const query = SearchQuery.create(request.query).value;
  if (!Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 10) {
    throw new InvalidArgumentError('maxResults must be an integer between 1 and 10');
  }

  const sourcePolicy = request.sourcePolicy ?? 'prefer';
  if (!SOURCE_POLICIES.includes(sourcePolicy)) {
    throw new InvalidArgumentError('sourcePolicy must be strict, prefer or any');
  }
  if (request.timeRange !== undefined && !TIME_RANGES.includes(request.timeRange)) {
    throw new InvalidArgumentError('timeRange must be day, month or year');
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
    contractVersion: 3,
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export function normalizeDomain(value: string): string {
  return DomainName.create(value).value;
}

export function domainMatches(hostname: string, domain: string): boolean {
  return DomainName.create(domain).matches(hostname);
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
    if (language === undefined) throw new InvalidArgumentError('The language is missing');
    return language;
  } catch (error) {
    throw new InvalidArgumentError(`Invalid language: ${value}`, { cause: error });
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
