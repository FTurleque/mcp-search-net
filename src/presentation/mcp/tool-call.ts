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
    return {
      content: [{ type: 'text', text: formatExternalContentText(options.formatText(validated)) }],
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
    return { code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { code: 'INVALID_ARGUMENT', message: 'The tool arguments are invalid' };
  }
  return { code: 'INTERNAL_ERROR', message: 'Unexpected internal error' };
}

function elapsedMilliseconds(startedAt: number, endedAt: number): number {
  return Math.max(0, Number((endedAt - startedAt).toFixed(3)));
}
