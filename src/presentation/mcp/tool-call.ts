import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod/v4';

import { ApplicationError } from '../../domain/errors/domain-errors.js';
import type {
  ToolErrorCode,
  ToolErrorResponse,
  ToolExecution,
  ToolName,
  ToolResponse,
} from '../../domain/models/tool-response.js';
import { isToolErrorCode } from '../../domain/models/tool-response.js';
import type { StructuredLogger } from '../../infrastructure/logging/structured-logger.js';

export interface ToolCallOptions<T> {
  readonly tool: ToolName;
  readonly logger: StructuredLogger;
  readonly execute: () => Promise<ToolExecution<T>>;
  readonly validateResponse: (response: ToolResponse<T>) => ToolResponse<T>;
  readonly formatText: (response: ToolResponse<T>) => string;
  readonly requestIdFactory?: () => string;
  readonly monotonicNow?: () => number;
}

export async function executeToolCall<T>(options: ToolCallOptions<T>): Promise<CallToolResult> {
  const requestId = (options.requestIdFactory ?? randomUUID)();
  const monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
  const startedAt = monotonicNow();
  options.logger.info('tool_call_started', { requestId, tool: options.tool });

  try {
    const execution = await options.execute();
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

    options.logger.info('tool_call_completed', {
      requestId,
      tool: options.tool,
      durationMs,
      cacheStatus: execution.cacheStatus,
      status: execution.status,
      warningCount: execution.warnings.length,
    });
    return {
      content: [{ type: 'text', text: options.formatText(validated) }],
      structuredContent: validated as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const durationMs = elapsedMilliseconds(startedAt, monotonicNow());
    const publicError = toPublicToolError(error);
    const response: ToolErrorResponse = {
      schemaVersion: '1.0',
      requestId,
      error: { ...publicError, requestId },
      metadata: { tool: options.tool, durationMs },
    };
    options.logger.error('tool_call_failed', {
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
