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
      .strict()
      .default({ name: 'mcp-search-net', version: '1.0.0' }),
    searxng: z
      .object({
        baseUrl: httpUrlSchema.default('http://127.0.0.1:8888'),
        timeoutMs: durationSchema.max(20_000).default(15_000),
      })
      .strict()
      .default({ baseUrl: 'http://127.0.0.1:8888', timeoutMs: 15_000 }),
    crawl4ai: z
      .object({
        baseUrl: httpUrlSchema.default('http://127.0.0.1:11235'),
        timeoutMs: durationSchema.max(20_000).default(20_000),
        apiTokenEnvironmentVariable: z.string().min(1).optional(),
        apiToken: z.string().min(16).optional(),
      })
      .strict()
      .default({ baseUrl: 'http://127.0.0.1:11235', timeoutMs: 20_000 }),
    cache: z
      .object({
        enabled: z.boolean().default(true),
        continueOnError: z.boolean().default(true),
        path: z.string().min(1).default('../.data/cache.sqlite'),
        searchTtlMs: durationSchema.default(3_600_000),
        documentationTtlMs: durationSchema.default(86_400_000),
        readmeTtlMs: durationSchema.default(21_600_000),
        sitemapTtlMs: durationSchema.default(86_400_000),
        temporaryErrorTtlMs: durationSchema.default(300_000),
        staleRetentionMs: durationSchema.default(604_800_000),
        maxEntries: z.number().int().min(10).max(100_000).default(2_000),
      })
      .strict()
      .default({
        enabled: true,
        continueOnError: true,
        path: '../.data/cache.sqlite',
        searchTtlMs: 3_600_000,
        documentationTtlMs: 86_400_000,
        readmeTtlMs: 21_600_000,
        sitemapTtlMs: 86_400_000,
        temporaryErrorTtlMs: 300_000,
        staleRetentionMs: 604_800_000,
        maxEntries: 2_000,
      }),
    limits: z
      .object({
        defaultSearchResults: z.number().int().min(1).max(10).default(5),
        maxSearchResults: z.number().int().min(1).max(10).default(10),
        providerOversampling: z.number().int().min(1).max(10).default(3),
        maxSnippetChars: z.number().int().min(50).max(500).default(500),
        defaultFetchChars: z.number().int().min(1_000).max(30_000).default(12_000),
        maxFetchChars: z.number().int().min(1_000).max(30_000).default(30_000),
        defaultFetchSections: z.number().int().min(1).max(10).default(5),
        maxFetchSections: z.number().int().min(1).max(10).default(10),
        maxLinks: z.number().int().min(0).max(50).default(50),
      })
      .strict()
      .default({
        defaultSearchResults: 5,
        maxSearchResults: 10,
        providerOversampling: 3,
        maxSnippetChars: 500,
        defaultFetchChars: 12_000,
        maxFetchChars: 30_000,
        defaultFetchSections: 5,
        maxFetchSections: 10,
        maxLinks: 50,
      }),
    security: z
      .object({
        allowedPorts: z.array(z.number().int().min(1).max(65_535)).min(1).default([80, 443]),
        allowHttp: z.boolean().default(true),
        maxDownloadBytes: z.number().int().min(1_024).max(10_485_760).default(10_485_760),
        maxRedirects: z.number().int().min(0).max(5).default(5),
        maxConcurrency: z.number().int().min(1).max(16).default(4),
        minimumDelayMs: z.number().int().min(0).max(10_000).default(250),
        respectRobotsTxt: z.boolean().default(true),
      })
      .strict()
      .default({
        allowedPorts: [80, 443],
        allowHttp: true,
        maxDownloadBytes: 10_485_760,
        maxRedirects: 5,
        maxConcurrency: 4,
        minimumDelayMs: 250,
        respectRobotsTxt: true,
      }),
    officialSourcesPath: z.string().min(1).default('official-sources.yml'),
    logging: z
      .object({
        level: z.enum(['debug', 'info', 'warning', 'error']).default('info'),
      })
      .strict()
      .default({ level: 'info' }),
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
    if (config.limits.defaultFetchSections > config.limits.maxFetchSections) {
      context.addIssue({
        code: 'custom',
        path: ['limits', 'defaultFetchSections'],
        message: 'Must not exceed maxFetchSections',
      });
    }
  });

export type ApplicationConfig = z.infer<typeof applicationConfigSchema>;

export const applicationEnvironmentSchema = z.object({
  MCP_CONFIG_PATH: z.string().min(1).optional(),
  MCP_LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  MCP_CACHE_PATH: z.string().min(1).optional(),
  MCP_OFFICIAL_SOURCES_PATH: z.string().min(1).optional(),
  MCP_SEARXNG_URL: httpUrlSchema.optional(),
  MCP_CRAWL4AI_URL: httpUrlSchema.optional(),
  MCP_CRAWL4AI_TOKEN: z.string().min(16).optional(),
});

export type ApplicationEnvironment = z.infer<typeof applicationEnvironmentSchema>;

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
          githubOrganizations: z
            .array(z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/))
            .max(20)
            .default([]),
          keywords: z.array(z.string().min(2)).default([]),
          priority: z.number().int().min(0).max(1_000).default(0),
          enabled: z.boolean().default(true),
        })
        .strict(),
    ),
  })
  .strict();

export type OfficialSourcesFile = z.infer<typeof officialSourcesFileSchema>;
