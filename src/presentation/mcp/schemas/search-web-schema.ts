import { z } from 'zod/v4';

import {
  MAX_EXTERNAL_ENGINE_NAME_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../../domain/services/bounded-text.js';
import { containsControlCharacters } from '../../../domain/services/text-validation.js';
import { acceptInvalidToolInput } from './invalid-tool-input.js';
import { createToolResponseSchema } from './tool-response-schema.js';

export function createSearchWebSchemas(defaultResults: number, maximumResults: number) {
  const domain = z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^(?!.*[\s/:@?#])[\p{L}\p{N}.-]+$/u);
  const input = acceptInvalidToolInput(
    z
      .object({
        query: z
          .string()
          .trim()
          .min(2)
          .max(500)
          .refine((value) => !containsControlCharacters(value), {
            message: 'Control characters are not allowed',
          })
          .describe('Web search terms'),
        sourcePolicy: z.enum(['strict', 'prefer', 'any']).default('prefer'),
        allowedDomains: z.array(domain).max(20).default([]),
        excludedDomains: z.array(domain).max(20).default([]),
        language: z
          .string()
          .trim()
          .max(MAX_EXTERNAL_LANGUAGE_CHARACTERS)
          .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
          .default('fr-FR')
          .describe('BCP-47-like language code, for example fr or en-US'),
        timeRange: z.enum(['day', 'month', 'year']).optional(),
        maxResults: z.number().int().min(1).max(maximumResults).default(defaultResults),
      })
      .strict(),
  );

  const result = z
    .object({
      title: z.string().max(MAX_EXTERNAL_TITLE_CHARACTERS),
      url: z.url(),
      domain: z.string().max(253),
      snippet: z.string().max(500),
      sourceStatus: z.enum(['VERIFIED_OFFICIAL', 'LIKELY_OFFICIAL', 'THIRD_PARTY', 'UNKNOWN']),
      engines: z.array(z.string().max(MAX_EXTERNAL_ENGINE_NAME_CHARACTERS)).max(32),
      publishedAt: z.iso.datetime().optional(),
      updatedAt: z.iso.datetime().optional(),
      detectedLanguage: z.string().max(MAX_EXTERNAL_LANGUAGE_CHARACTERS).optional(),
      score: z.number().min(0).max(1),
    })
    .strict();

  const data = z
    .object({
      query: z.string(),
      results: z.array(result),
      metadata: z
        .object({
          total: z.number(),
          returned: z.number(),
          unresponsiveEngines: z
            .array(z.string().max(MAX_EXTERNAL_ENGINE_NAME_CHARACTERS))
            .max(32),
          sourceProvider: z.literal('searxng'),
          retrievedAt: z.iso.datetime(),
        })
        .strict(),
    })
    .strict();
  const output = createToolResponseSchema('search_web', data);

  return { input, data, output } as const;
}
