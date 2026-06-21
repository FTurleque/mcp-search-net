export const CACHE_STATUSES = ['HIT', 'MISS', 'STALE_FALLBACK', 'DISABLED'] as const;
export type CacheStatus = (typeof CACHE_STATUSES)[number];

export const TOOL_WARNING_CODES = [
  'NO_RESULTS',
  'NO_VERIFIED_OFFICIAL_SOURCE',
  'NON_OFFICIAL_RESULTS_INCLUDED',
  'RESULTS_TRUNCATED',
  'CONTENT_TRUNCATED',
  'SECTION_TRUNCATED',
  'FALLBACK_LANGUAGE_USED',
  'STALE_CACHE_USED',
  'REDIRECTED_URL',
  'JAVASCRIPT_FALLBACK_USED',
  'NO_RELEVANT_SECTION',
  'UNVERIFIED_SOURCE',
] as const;
export type ToolWarningCode = (typeof TOOL_WARNING_CODES)[number];

export const TOOL_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'INVALID_URL',
  'UNSUPPORTED_PROTOCOL',
  'BLOCKED_ADDRESS',
  'DNS_RESOLUTION_FAILED',
  'TOO_MANY_REDIRECTS',
  'REQUEST_TIMEOUT',
  'RESPONSE_TOO_LARGE',
  'HTTP_ERROR',
  'SEARCH_PROVIDER_UNAVAILABLE',
  'CONTENT_PROVIDER_UNAVAILABLE',
  'UNSUPPORTED_CONTENT_TYPE',
  'EXTRACTION_FAILED',
  'NO_RELEVANT_CONTENT',
  'OCR_REQUIRED_NOT_SUPPORTED',
  'CACHE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export type ToolName = 'search_web' | 'fetch_url';
export type ToolResponseStatus = 'success' | 'partial';

export interface ToolWarningDescriptor {
  readonly code: ToolWarningCode;
  readonly message: string;
}

export interface ToolWarning extends ToolWarningDescriptor {
  readonly requestId: string;
}

export interface ToolExecution<T> {
  readonly status: ToolResponseStatus;
  readonly warnings: readonly ToolWarningDescriptor[];
  readonly cacheStatus: CacheStatus;
  readonly provider: string;
  readonly data: T;
}

export interface ToolResponse<T> {
  readonly schemaVersion: '1.0';
  readonly requestId: string;
  readonly status: ToolResponseStatus;
  readonly warnings: readonly ToolWarning[];
  readonly metadata: {
    readonly tool: ToolName;
    readonly durationMs: number;
    readonly cacheStatus: CacheStatus;
    readonly provider: string;
  };
  readonly data: T;
}

export interface ToolErrorResponse {
  readonly schemaVersion: '1.0';
  readonly requestId: string;
  readonly error: {
    readonly code: ToolErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
  readonly metadata: {
    readonly tool: ToolName;
    readonly durationMs: number;
  };
}

export function isToolErrorCode(value: string): value is ToolErrorCode {
  return (TOOL_ERROR_CODES as readonly string[]).includes(value);
}
