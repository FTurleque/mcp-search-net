import { z } from 'zod/v4';

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
        url: z.url().describe('Known public HTTP(S) URL to fetch'),
        query: z
          .string()
          .trim()
          .min(2)
          .max(500)
          .optional()
          .describe('Terms used by the local BM25 section selector'),
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
      heading: z.string(),
      markdown: z.string(),
      score: z.number().nonnegative(),
      truncated: z.boolean(),
    })
    .strict();
  const data = z
    .object({
      requestedUrl: z.url(),
      finalUrl: z.url(),
      canonicalUrl: z.url(),
      domain: z.string().min(1),
      title: z.string().optional(),
      contentType: z.string().min(1),
      sourceStatus: z.enum(['VERIFIED_OFFICIAL', 'LIKELY_OFFICIAL', 'THIRD_PARTY', 'UNKNOWN']),
      fetchedAt: z.iso.datetime(),
      extractionMode: z.enum(['static', 'native-render']),
      truncated: z.boolean(),
      sectionCount: z.number().int().nonnegative(),
      sections: z.array(section),
      markdown: z.string(),
      links: z.array(z.url()),
    })
    .strict();
  return { input, data, output: createToolResponseSchema('fetch_url', data) } as const;
}
