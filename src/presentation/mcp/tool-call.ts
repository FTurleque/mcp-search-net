import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod/v4';

import {
  ApplicationError,
  HttpError,
  isTransientHttpStatus,
  SearchProviderUnavailableError,
} from '../../domain/errors/domain-errors.js';
import type {
  ToolErrorCode,
  ToolErrorResponse,
  ToolExecution,
  ToolName,
  ToolResponse,
} from '../../domain/models/tool-response.js';
import {
  EXTERNAL_CONTENT_SAFETY_NOTICE,
  EXTERNAL_CONTENT_TRUST,
  isToolErrorCode,
} from '../../domain/models/tool-response.js';
import { countUnicodeCharacters } from '../../domain/services/bounded-text.js';
import type { Logger } from '../../application/ports/logger.js';

export interface ToolCallOptions<T> {
  readonly tool: ToolName;
  readonly logger: Logger;
  readonly execute: (requestId: string) => Promise<ToolExecution<T>>;
  readonly validateResponse: (response: ToolResponse<T>) => ToolResponse<T>;
  readonly formatText: (response: ToolResponse<T>) => string;
  readonly requestIdFactory?: () => string;
  readonly monotonicNow?: () => number;
}

const PUBLIC_TOOL_ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = {
  INVALID_ARGUMENT: 'The tool arguments are invalid',
  INVALID_URL: 'The Web URL is invalid',
  UNSUPPORTED_PROTOCOL: 'Only HTTP and HTTPS protocols are supported',
  BLOCKED_ADDRESS: 'The address is blocked by the public URL policy',
  DNS_RESOLUTION_FAILED: 'The hostname cannot be resolved safely',
  TOO_MANY_REDIRECTS: 'The maximum number of redirects was exceeded',
  REQUEST_TIMEOUT: 'The request timed out',
  RESPONSE_TOO_LARGE: 'The response exceeds the allowed size',
  HTTP_ERROR: 'The remote server returned an HTTP error',
  SEARCH_PROVIDER_UNAVAILABLE: 'The search provider is unavailable',
  CONTENT_PROVIDER_UNAVAILABLE: 'The content provider is unavailable',
  UNSUPPORTED_CONTENT_TYPE: 'The content type is not supported',
  EXTRACTION_FAILED: 'The content could not be extracted',
  NO_RELEVANT_CONTENT: 'No relevant content was found',
  OCR_REQUIRED_NOT_SUPPORTED: 'OCR is required and is not supported in V1',
  CACHE_UNAVAILABLE: 'The cache is unavailable',
  INTERNAL_ERROR: 'Unexpected internal error',
};

export async function executeToolCall<T>(options: ToolCallOptions<T>): Promise<CallToolResult> {
  const requestId = (options.requestIdFactory ?? randomUUID)();
  const monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
  const startedAt = monotonicNow();
  options.logger.record('tool_call_started', { requestId, tool: options.tool });

  try {
    const execution = await options.execute(requestId);
    const durationMs = elapsedMilliseconds(startedAt, monotonicNow());
    const response: ToolResponse<T> = {
      schemaVersion: '1.0',
      requestId,
      status: execution.status,
      warnings: execution.warnings.map((warning) => ({ ...warning, requestId })),
      metadata: {
        tool: options.tool,
        durationMs,
        cacheStatus: execution.cacheStatus,
        provider: execution.provider,
        contentTrust: EXTERNAL_CONTENT_TRUST,
        contentSafetyNotice: EXTERNAL_CONTENT_SAFETY_NOTICE,
      },
      data: execution.data,
    };

    let validated: ToolResponse<T>;
    try {
      validated = options.validateResponse(response);
    } catch (error) {
      throw new ApplicationError(
        'The server generated an invalid tool response',
        'INTERNAL_ERROR',
        {
          cause: error,
        },
      );
    }

    options.logger.record('tool_call_completed', {
      requestId,
      tool: options.tool,
      durationMs,
      cacheStatus: execution.cacheStatus,
      status: execution.status,
      warningCount: execution.warnings.length,
      ...summarizeData(execution.data),
    });
    const formattedText = options.formatText(validated);
    const text =
      options.tool === 'read_doc_section'
        ? `requestId=${validated.requestId} cache=${validated.metadata.cacheStatus}\n${formattedText}`
        : formattedText;
    return {
      content: [{ type: 'text', text: formatExternalContentText(text) }],
      structuredContent: validated as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const durationMs = elapsedMilliseconds(startedAt, monotonicNow());
    const publicError = toPublicToolError(error);
    const response: ToolErrorResponse = {
      schemaVersion: '1.0',
      requestId,
      ...publicError,
      retryable: isRetryable(error, publicError.code),
    };
    options.logger.record('tool_call_failed', {
      requestId,
      tool: options.tool,
      durationMs,
      code: publicError.code,
      error: error instanceof Error ? error : String(error),
    });
    return {
      content: [
        {
          type: 'text',
          text: `${options.tool} failed (${publicError.code}) [${requestId}]: ${publicError.message}`,
        },
      ],
      _meta: { 'mcp-search-net/error': response },
      isError: true,
    };
  }
}

function formatExternalContentText(text: string): string {
  return `[${EXTERNAL_CONTENT_TRUST}] ${EXTERNAL_CONTENT_SAFETY_NOTICE}\n\n${text}`;
}

function isRetryable(error: unknown, code: ToolErrorCode): boolean {
  if (error instanceof HttpError) {
    return error.status === undefined || isTransientHttpStatus(error.status);
  }
  if (error instanceof SearchProviderUnavailableError && error.status !== undefined) {
    return isTransientHttpStatus(error.status);
  }
  return [
    'DNS_RESOLUTION_FAILED',
    'REQUEST_TIMEOUT',
    'SEARCH_PROVIDER_UNAVAILABLE',
    'CONTENT_PROVIDER_UNAVAILABLE',
    'CACHE_UNAVAILABLE',
  ].includes(code);
}

function summarizeData(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  return {
    ...(Array.isArray(record['results']) ? { resultCount: record['results'].length } : {}),
    ...(Array.isArray(record['sections']) ? { sectionCount: record['sections'].length } : {}),
    ...(typeof record['markdown'] === 'string'
      ? { outputCharacters: countUnicodeCharacters(record['markdown']) }
      : {}),
    ...(typeof record['domain'] === 'string' ? { domain: record['domain'] } : {}),
  };
}

export function toPublicToolError(error: unknown): {
  readonly code: ToolErrorCode;
  readonly message: string;
} {
  if (error instanceof ApplicationError && isToolErrorCode(error.code)) {
    return { code: error.code, message: PUBLIC_TOOL_ERROR_MESSAGES[error.code] };
  }
  if (error instanceof ZodError) {
    return { code: 'INVALID_ARGUMENT', message: PUBLIC_TOOL_ERROR_MESSAGES.INVALID_ARGUMENT };
  }
  return { code: 'INTERNAL_ERROR', message: PUBLIC_TOOL_ERROR_MESSAGES.INTERNAL_ERROR };
}

function elapsedMilliseconds(startedAt: number, endedAt: number): number {
  return Math.max(0, Number((endedAt - startedAt).toFixed(3)));
}
