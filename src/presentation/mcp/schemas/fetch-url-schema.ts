import { z } from 'zod/v4';

export function createFetchUrlSchemas(defaultChars: number, maximumChars: number) {
  const input = z
    .object({
      url: z.url().describe('Known public HTTP(S) URL to fetch'),
      query: z
        .string()
        .trim()
        .min(2)
        .max(500)
        .optional()
        .describe('Terms used to select only relevant sections'),
      maxChars: z.number().int().min(1_000).max(maximumChars).default(defaultChars),
    })
    .strict();

  const output = z
    .object({
      url: z.url(),
      resolvedUrl: z.url(),
      title: z.string().optional(),
      markdown: z.string(),
      sectionHeadings: z.array(z.string()),
      metadata: z
        .object({
          contentType: z.string().optional(),
          fetchedAt: z.string(),
          cached: z.boolean(),
          truncated: z.boolean(),
          wordCount: z.number().int().nonnegative(),
          links: z.array(z.url()),
          source: z.record(z.string(), z.unknown()),
        })
        .strict(),
    })
    .strict();

  return { input, output } as const;
}
