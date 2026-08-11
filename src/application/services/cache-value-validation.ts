import { z } from 'zod/v4';

import type { FetchedContent } from '../../domain/models/content.js';
import type { SearchResponse } from '../../domain/models/search.js';
import {
  TOOL_WARNING_CODES,
  type ToolResponseStatus,
  type ToolWarningDescriptor,
} from '../../domain/models/tool-response.js';
import {
  countUnicodeCharacters,
  MAX_CATALOG_URL_CHARACTERS,
  MAX_EXTERNAL_DOCUMENT_SECTIONS,
  MAX_EXTERNAL_ENGINE_NAME_CHARACTERS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
} from '../../domain/services/bounded-text.js';

export interface SearchCacheValue {
  readonly status: ToolResponseStatus;
  readonly warnings: readonly ToolWarningDescriptor[];
  readonly data: SearchResponse;
}

const MAX_SEARCH_RESULTS = 10;
const MAX_SEARCH_SNIPPET_CHARACTERS = 500;
const MAX_SEARCH_ENGINES = 32;
const MAX_REDIRECTS = 5;
const MAX_CACHE_VALIDATOR_CHARACTERS = 1_024;

const unicodeBoundedString = (maximum: number) =>
  z.string().refine((value) => countUnicodeCharacters(value) <= maximum, {
    message: `Expected at most ${maximum} Unicode characters`,
  });

const httpUrlSchema = z
  .url()
  .max(MAX_CATALOG_URL_CHARACTERS)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  }, 'Expected an HTTP(S) URL without credentials');

const isoDateTimeSchema = z.iso.datetime();
const sourceStatusSchema = z.enum([
  'VERIFIED_OFFICIAL',
  'LIKELY_OFFICIAL',
  'THIRD_PARTY',
  'UNKNOWN',
]);
const warningSchema = z
  .object({
    code: z.enum(TOOL_WARNING_CODES),
    message: z.string().min(1),
  })
  .strict();
const searchResultSchema = z
  .object({
    title: unicodeBoundedString(MAX_EXTERNAL_TITLE_CHARACTERS),
    url: httpUrlSchema,
    domain: z.string().min(1).max(253),
    snippet: unicodeBoundedString(MAX_SEARCH_SNIPPET_CHARACTERS),
    sourceStatus: sourceStatusSchema,
    engines: z
      .array(unicodeBoundedString(MAX_EXTERNAL_ENGINE_NAME_CHARACTERS))
      .max(MAX_SEARCH_ENGINES),
    publishedAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
    detectedLanguage: unicodeBoundedString(MAX_EXTERNAL_LANGUAGE_CHARACTERS).optional(),
    score: z.number().min(0).max(1),
  })
  .strict();
const searchResponseSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    results: z.array(searchResultSchema).max(MAX_SEARCH_RESULTS),
    metadata: z
      .object({
        total: z.number().finite(),
        returned: z.number().int().nonnegative(),
        unresponsiveEngines: z
          .array(unicodeBoundedString(MAX_EXTERNAL_ENGINE_NAME_CHARACTERS))
          .max(MAX_SEARCH_ENGINES),
        sourceProvider: z.literal('searxng'),
        retrievedAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.metadata.returned === value.results.length, {
    message: 'Cached returned count must match the result array length',
    path: ['metadata', 'returned'],
  });
const searchCacheValueSchema = z
  .object({
    status: z.enum(['success', 'partial']),
    warnings: z.array(warningSchema),
    data: searchResponseSchema,
  })
  .strict();

const documentSectionSchema = z
  .object({
    heading: unicodeBoundedString(MAX_EXTERNAL_HEADING_CHARACTERS),
    markdown: z.string(),
  })
  .strict();
const redirectSchema = z
  .object({
    fromUrl: httpUrlSchema,
    toUrl: httpUrlSchema,
    status: z.number().int().min(300).max(399).refine((status) => status !== 304),
    permanent: z.boolean(),
  })
  .strict();
const safeValidatorSchema = z
  .string()
  .max(MAX_CACHE_VALIDATOR_CHARACTERS)
  .refine((value) => !/[\r\n]/u.test(value), 'Header validators must not contain CR/LF');
const fetchedContentSchema = z
  .object({
    requestedUrl: httpUrlSchema,
    finalUrl: httpUrlSchema,
    canonicalUrl: httpUrlSchema,
    title: unicodeBoundedString(MAX_EXTERNAL_TITLE_CHARACTERS).optional(),
    markdown: z.string().min(1),
    documentSections: z
      .array(documentSectionSchema)
      .min(1)
      .max(MAX_EXTERNAL_DOCUMENT_SECTIONS),
    contentType: z.string().min(1),
    fetchedAt: isoDateTimeSchema,
    extractionMode: z.enum(['static', 'native-render']),
    statusCode: z.number().int().min(200).max(299),
    etag: safeValidatorSchema.optional(),
    lastModified: safeValidatorSchema.optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    redirectChain: z.array(redirectSchema).max(MAX_REDIRECTS),
    metadata: z.record(z.string(), z.unknown()),
    links: z.array(httpUrlSchema),
  })
  .strict();

export function decodeSearchCacheValue(value: unknown): SearchCacheValue | undefined {
  const parsed = searchCacheValueSchema.safeParse(value);
  return parsed.success ? (parsed.data as SearchCacheValue) : undefined;
}

export function decodeFetchedContent(value: unknown): FetchedContent | undefined {
  const parsed = fetchedContentSchema.safeParse(value);
  return parsed.success ? (parsed.data as FetchedContent) : undefined;
}
