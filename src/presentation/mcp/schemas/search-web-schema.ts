import { z } from 'zod/v4';

export function createSearchWebSchemas(defaultResults: number, maximumResults: number) {
  const input = z
    .object({
      query: z.string().trim().min(2).max(500).describe('Web search terms'),
      language: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
        .optional()
        .describe('BCP-47-like language code, for example fr or en-US'),
      timeRange: z.enum(['day', 'month', 'year']).optional(),
      maxResults: z.number().int().min(1).max(maximumResults).default(defaultResults),
      officialOnly: z.boolean().default(false),
    })
    .strict();

  const result = z
    .object({
      title: z.string(),
      url: z.url(),
      snippet: z.string(),
      source: z.string(),
      official: z.boolean(),
      engines: z.array(z.string()),
      publishedAt: z.string().optional(),
      score: z.number(),
    })
    .strict();

  const output = z
    .object({
      query: z.string(),
      results: z.array(result),
      metadata: z
        .object({
          cached: z.boolean(),
          total: z.number(),
          returned: z.number(),
          unresponsiveEngines: z.array(z.string()),
        })
        .strict(),
    })
    .strict();

  return { input, output } as const;
}
