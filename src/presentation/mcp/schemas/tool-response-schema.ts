import { z } from 'zod/v4';

import {
  CACHE_STATUSES,
  TOOL_ERROR_CODES,
  TOOL_WARNING_CODES,
} from '../../../domain/models/tool-response.js';
import type { ToolName } from '../../../domain/models/tool-response.js';

export const toolWarningSchema = z
  .object({
    code: z.enum(TOOL_WARNING_CODES),
    message: z.string().min(1),
    requestId: z.uuid(),
  })
  .strict();

export function createToolResponseSchema<T extends z.ZodType>(tool: ToolName, data: T) {
  return z
    .object({
      schemaVersion: z.literal('1.0'),
      requestId: z.uuid(),
      status: z.enum(['success', 'partial']),
      warnings: z.array(toolWarningSchema),
      metadata: z
        .object({
          tool: z.literal(tool),
          durationMs: z.number().nonnegative(),
          cacheStatus: z.enum(CACHE_STATUSES),
          provider: z.string().min(1),
        })
        .strict(),
      data,
    })
    .strict();
}

export const toolErrorResponseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    requestId: z.uuid(),
    code: z.enum(TOOL_ERROR_CODES),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();
