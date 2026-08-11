import { z } from 'zod/v4';

import {
  MAX_EXTERNAL_ANCHOR_CHARACTERS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../../domain/services/bounded-text.js';
import { containsControlCharacters } from '../../../domain/services/text-validation.js';
import { acceptInvalidToolInput } from './invalid-tool-input.js';
import { createToolResponseSchema } from './tool-response-schema.js';

export function createSearchDocsSchemas(defaultResults: number, maximumResults: number) {
  const sourceKey = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u)
    .describe('Optional catalog source key filter');
  const input = acceptInvalidToolInput(
    z
      .object({
        query: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .refine((value) => !containsControlCharacters(value), {
            message: 'Control characters are not allowed',
          })
          .describe('Catalog document search terms'),
        sourceKey: sourceKey.optional(),
        language: z
          .string()
          .trim()
          .max(MAX_EXTERNAL_LANGUAGE_CHARACTERS)
          .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
          .optional()
          .describe('Optional BCP-47-like language filter, for example fr or en-US'),
        maxResults: z.number().int().min(1).max(maximumResults).default(defaultResults),
        maxSnippetChars: z.number().int().min(80).max(500).default(240),
        compact: z.boolean().default(false),
      })
      .strict(),
  );

  const result = z
    .object({
      sourceKey: z.string().min(1).max(128),
      sourceName: z.string().min(1).max(200),
      documentPublicId: z.string().min(1).max(128),
      sectionId: z.number().int().positive(),
      title: z.string().min(1).max(MAX_EXTERNAL_TITLE_CHARACTERS),
      url: z.url(),
      language: z.string().min(1).max(MAX_EXTERNAL_LANGUAGE_CHARACTERS),
      heading: z.string().max(MAX_EXTERNAL_HEADING_CHARACTERS).optional(),
      headingPath: z.string().max(MAX_EXTERNAL_HEADING_PATH_CHARACTERS).optional(),
      anchor: z.string().max(MAX_EXTERNAL_ANCHOR_CHARACTERS).optional(),
      snippet: z.string().max(500),
      score: z.number().nonnegative(),
    })
    .strict();
  const data = z
    .object({
      query: z.string(),
      resultCount: z.number().int().nonnegative(),
      results: z.array(result),
    })
    .strict();

  return { input, data, output: createToolResponseSchema('search_docs', data) } as const;
}
