import { z } from 'zod/v4';

import {
  countUnicodeCharacters,
  MAX_EXTERNAL_DOCUMENT_SECTIONS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../../domain/services/bounded-text.js';
import { acceptInvalidToolInput } from './invalid-tool-input.js';
import { createToolResponseSchema } from './tool-response-schema.js';

export function createFetchUrlSchemas(
  defaultCharacters: number,
  maximumCharacters: number,
  defaultSections: number,
  maximumSections: number,
) {
  const input = acceptInvalidToolInput(
    z
      .object({
        url: z.url().max(4_096).describe('Known public HTTP(S) URL to fetch'),
        query: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe('Terms used by the deterministic lexical section selector'),
        maxCharacters: z
          .number()
          .int()
          .min(1_000)
          .max(maximumCharacters)
          .default(defaultCharacters),
        maxSections: z.number().int().min(1).max(maximumSections).default(defaultSections),
        renderMode: z.enum(['static', 'auto']).default('static'),
      })
      .strict(),
  );

  const section = z
    .object({
      heading: unicodeBoundedString(MAX_EXTERNAL_HEADING_CHARACTERS),
      markdown: z.string(),
      score: z.number().min(0).max(1),
      truncated: z.boolean(),
    })
    .strict();
  const data = z
    .object({
      requestedUrl: z.url(),
      finalUrl: z.url(),
      canonicalUrl: z.url(),
      domain: z.string().min(1),
      title: unicodeBoundedString(MAX_EXTERNAL_TITLE_CHARACTERS).optional(),
      contentType: z.string().min(1),
      sourceStatus: z.enum(['VERIFIED_OFFICIAL', 'LIKELY_OFFICIAL', 'THIRD_PARTY', 'UNKNOWN']),
      fetchedAt: z.iso.datetime(),
      extractionMode: z.enum(['static', 'native-render']),
      truncated: z.boolean(),
      sectionCount: z.number().int().nonnegative().max(MAX_EXTERNAL_DOCUMENT_SECTIONS),
      sections: z.array(section).max(MAX_EXTERNAL_DOCUMENT_SECTIONS),
      markdown: z.string(),
      links: z.array(z.url()),
    })
    .strict();
  return { input, data, output: createToolResponseSchema('fetch_url', data) } as const;
}

function unicodeBoundedString(maximumCharacters: number) {
  return z.string().refine((value) => countUnicodeCharacters(value) <= maximumCharacters, {
    message: `Must contain at most ${maximumCharacters} Unicode characters`,
  });
}
