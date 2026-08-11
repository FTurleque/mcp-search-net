import type { FetchedContent } from '../../domain/models/content.js';
import type { SearchResponse, SearchResult, SourceStatus } from '../../domain/models/search.js';
import {
  TOOL_WARNING_CODES,
  type ToolResponseStatus,
  type ToolWarningDescriptor,
} from '../../domain/models/tool-response.js';

export interface SearchCacheValue {
  readonly status: ToolResponseStatus;
  readonly warnings: readonly ToolWarningDescriptor[];
  readonly data: SearchResponse;
}

const SOURCE_STATUSES = new Set<SourceStatus>([
  'VERIFIED_OFFICIAL',
  'LIKELY_OFFICIAL',
  'THIRD_PARTY',
  'UNKNOWN',
]);
const WARNING_CODES = new Set<string>(TOOL_WARNING_CODES);

export function decodeSearchCacheValue(value: unknown): SearchCacheValue | undefined {
  if (!isRecord(value)) return undefined;
  if (value['status'] !== 'success' && value['status'] !== 'partial') return undefined;
  if (!Array.isArray(value['warnings']) || !value['warnings'].every(isWarning)) return undefined;
  if (!isSearchResponse(value['data'])) return undefined;
  return value as unknown as SearchCacheValue;
}

export function decodeFetchedContent(value: unknown): FetchedContent | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value['requestedUrl']) ||
    !isString(value['finalUrl']) ||
    !isString(value['canonicalUrl']) ||
    !isString(value['markdown']) ||
    !isString(value['contentType']) ||
    !isString(value['fetchedAt']) ||
    !isString(value['contentHash']) ||
    !Number.isInteger(value['statusCode']) ||
    (value['extractionMode'] !== 'static' && value['extractionMode'] !== 'native-render') ||
    !Array.isArray(value['documentSections']) ||
    !value['documentSections'].every(isDocumentSection) ||
    !Array.isArray(value['redirectChain']) ||
    !value['redirectChain'].every(isRedirect) ||
    !isRecord(value['metadata']) ||
    !Array.isArray(value['links']) ||
    !value['links'].every(isString)
  ) {
    return undefined;
  }
  if (value['title'] !== undefined && !isString(value['title'])) return undefined;
  if (value['etag'] !== undefined && !isString(value['etag'])) return undefined;
  if (value['lastModified'] !== undefined && !isString(value['lastModified'])) return undefined;
  return value as unknown as FetchedContent;
}

function isSearchResponse(value: unknown): value is SearchResponse {
  if (!isRecord(value) || !isString(value['query']) || !Array.isArray(value['results'])) {
    return false;
  }
  if (!value['results'].every(isSearchResult)) return false;
  const metadata = value['metadata'];
  return (
    isRecord(metadata) &&
    isFiniteNumber(metadata['total']) &&
    isFiniteNumber(metadata['returned']) &&
    Array.isArray(metadata['unresponsiveEngines']) &&
    metadata['unresponsiveEngines'].every(isString) &&
    metadata['sourceProvider'] === 'searxng' &&
    isString(metadata['retrievedAt'])
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!isRecord(value)) return false;
  if (
    !isString(value['title']) ||
    !isString(value['url']) ||
    !isString(value['domain']) ||
    !isString(value['snippet']) ||
    !SOURCE_STATUSES.has(value['sourceStatus'] as SourceStatus) ||
    !Array.isArray(value['engines']) ||
    !value['engines'].every(isString) ||
    !isFiniteNumber(value['score'])
  ) {
    return false;
  }
  if (value['publishedAt'] !== undefined && !isString(value['publishedAt'])) return false;
  if (value['updatedAt'] !== undefined && !isString(value['updatedAt'])) return false;
  if (value['detectedLanguage'] !== undefined && !isString(value['detectedLanguage'])) return false;
  return true;
}

function isWarning(value: unknown): value is ToolWarningDescriptor {
  return (
    isRecord(value) &&
    isString(value['code']) &&
    WARNING_CODES.has(value['code']) &&
    isString(value['message'])
  );
}

function isDocumentSection(value: unknown): boolean {
  return isRecord(value) && isString(value['heading']) && isString(value['markdown']);
}

function isRedirect(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value['fromUrl']) &&
    isString(value['toUrl']) &&
    Number.isInteger(value['status']) &&
    typeof value['permanent'] === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
