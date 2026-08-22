import { z } from 'zod/v4';

import {
  SEARCH_HISTORY_STATUSES,
  SEARCH_HISTORY_TOOLS,
} from '../../../application/ports/search-history-repository.js';
import { CACHE_STATUSES, TOOL_WARNING_CODES } from '../../../domain/models/tool-response.js';
import { createToolResponseSchema } from './tool-response-schema.js';

const isoDateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO date-time');

export const listSearchHistoryInputSchema = z
  .object({
    tool: z.enum(SEARCH_HISTORY_TOOLS).optional(),
    status: z.enum(SEARCH_HISTORY_STATUSES).optional(),
    cacheStatus: z.enum(CACHE_STATUSES).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    queryContains: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    beforeId: z.number().int().positive().optional(),
  })
  .strict();

const searchHistoryEntrySchema = z
  .object({
    id: z.number().int().positive(),
    requestId: z.uuid(),
    tool: z.enum(SEARCH_HISTORY_TOOLS),
    query: z.string().min(1).max(500),
    request: z.record(z.string(), z.unknown()),
    executedAt: z.string().min(1).max(64),
    durationMs: z.number().nonnegative(),
    status: z.enum(SEARCH_HISTORY_STATUSES),
    cacheStatus: z.enum(CACHE_STATUSES).nullable(),
    provider: z.string().min(1).max(64),
    resultCount: z.number().int().nonnegative().nullable(),
    warningCodes: z.array(z.enum(TOOL_WARNING_CODES)),
    errorCode: z.string().min(1).max(64).nullable(),
  })
  .strict();

export const listSearchHistoryDataSchema = z
  .object({
    enabled: z.boolean(),
    available: z.boolean(),
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    nextBeforeId: z.number().int().positive().nullable(),
    searches: z.array(searchHistoryEntrySchema).max(50),
  })
  .strict();

export const listSearchHistoryOutputSchema = createToolResponseSchema(
  'list_search_history',
  listSearchHistoryDataSchema,
);
