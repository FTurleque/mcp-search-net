import { z } from 'zod/v4';

const durationSchema = z.number().int().positive();
const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Expected an HTTP or HTTPS URL');

export const applicationConfigSchema = z
  .object({
    application: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
      })
      .strict(),
    searxng: z
      .object({
        baseUrl: httpUrlSchema,
        timeoutMs: durationSchema,
      })
      .strict(),
    crawl4ai: z
      .object({
        baseUrl: httpUrlSchema,
        timeoutMs: durationSchema,
        apiTokenEnvironmentVariable: z.string().min(1).optional(),
        apiToken: z.string().min(16).optional(),
      })
      .strict(),
    cache: z
      .object({
        path: z.string().min(1),
        searchTtlMs: durationSchema,
        fetchTtlMs: durationSchema,
        maxEntries: z.number().int().min(10).max(1_000_000),
      })
      .strict(),
    limits: z
      .object({
        defaultSearchResults: z.number().int().min(1).max(10),
        maxSearchResults: z.number().int().min(1).max(20),
        providerOversampling: z.number().int().min(1).max(10),
        maxSnippetChars: z.number().int().min(50).max(2_000),
        defaultFetchChars: z.number().int().min(1_000).max(100_000),
        maxFetchChars: z.number().int().min(1_000).max(250_000),
        maxLinks: z.number().int().min(0).max(500),
      })
      .strict(),
    security: z
      .object({
        allowedPorts: z.array(z.number().int().min(1).max(65_535)).min(1),
        allowHttp: z.boolean(),
      })
      .strict(),
    officialSourcesPath: z.string().min(1),
    logging: z
      .object({
        level: z.enum(['debug', 'info', 'warning', 'error']),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.limits.defaultSearchResults > config.limits.maxSearchResults) {
      context.addIssue({
        code: 'custom',
        path: ['limits', 'defaultSearchResults'],
        message: 'Must not exceed maxSearchResults',
      });
    }
    if (config.limits.defaultFetchChars > config.limits.maxFetchChars) {
      context.addIssue({
        code: 'custom',
        path: ['limits', 'defaultFetchChars'],
        message: 'Must not exceed maxFetchChars',
      });
    }
  });

export type ApplicationConfig = z.infer<typeof applicationConfigSchema>;

export const officialSourcesFileSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
          name: z.string().min(1),
          domain: z.string().min(1),
          baseUrl: z.url(),
          pathPrefix: z.string().startsWith('/').optional(),
          includeSubdomains: z.boolean().default(true),
          keywords: z.array(z.string().min(2)).default([]),
          priority: z.number().int().min(0).max(1_000).default(0),
          enabled: z.boolean().default(true),
        })
        .strict(),
    ),
  })
  .strict();

export type OfficialSourcesFile = z.infer<typeof officialSourcesFileSchema>;
