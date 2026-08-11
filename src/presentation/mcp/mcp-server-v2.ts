import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type { Logger } from '../../application/ports/logger.js';
import type {
  SearchCatalogDocuments,
  SearchCatalogDocumentsOutput,
} from '../../application/use-cases/search-catalog-documents.js';
import { InvalidArgumentError, ResponseTooLargeError } from '../../domain/errors/domain-errors.js';
import type { CatalogDocument } from '../../domain/models/catalog.js';
import type { ToolResponse, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import {
  countUnicodeCharacters,
  MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';
import { registerCatalogResources } from './catalog-resources.js';
import type { McpServerDependencies as V1McpServerDependencies } from './mcp-server.js';
import { createMcpServer as createV1McpServer } from './mcp-server.js';
import { isInvalidToolInput } from './schemas/invalid-tool-input.js';
import { createSearchDocsSchemas } from './schemas/search-docs-schema.js';
import { createToolResponseSchema } from './schemas/tool-response-schema.js';
import { unicodeBoundedString } from './schemas/unicode-bounded-string.js';
import { executeToolCall } from './tool-call.js';

export interface McpServerV2Dependencies extends V1McpServerDependencies {
  readonly catalogRepository: CatalogRepository;
  readonly searchCatalogDocuments: SearchCatalogDocuments;
  readonly logger: Logger;
}

type SearchDocsData = Omit<SearchCatalogDocumentsOutput, 'schemaVersion'>;

const MAX_LIST_DOCS_DATA_CHARACTERS = 20_000;

const compactDocumentSchema = z
  .object({
    id: z.number().int().positive(),
    publicId: z.string().min(1).max(MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS),
    sourceKey: z.string().min(1).max(MAX_EXTERNAL_SOURCE_KEY_CHARACTERS),
    title: unicodeBoundedString(MAX_EXTERNAL_TITLE_CHARACTERS, 1),
    url: z.url(),
    language: z.string().min(1).max(MAX_EXTERNAL_LANGUAGE_CHARACTERS),
    status: z.string().min(1),
    currentVersionId: z.number().int().positive().nullable(),
  })
  .strict();

const listDocsInputSchema = z
  .object({
    sourceKey: z
      .string()
      .trim()
      .min(1)
      .max(MAX_EXTERNAL_SOURCE_KEY_CHARACTERS)
      .optional(),
    language: z.string().trim().min(1).max(MAX_EXTERNAL_LANGUAGE_CHARACTERS).optional(),
    status: z.enum(['ACTIVE', 'STALE', 'REDIRECTED', 'REMOVED', 'UNAVAILABLE']).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

const listDocsDataSchema = z
  .object({
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextOffset: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    documents: z.array(compactDocumentSchema),
  })
  .strict();

const listDocsOutputSchema = createToolResponseSchema('list_docs', listDocsDataSchema);

type ListDocsData = z.infer<typeof listDocsDataSchema>;

const readDocSectionInputSchema = z
  .object({
    sectionId: z.number().int().positive(),
    maxCharacters: z.number().int().min(200).max(8000).default(3000),
  })
  .strict();

const sectionDocumentSchema = z
  .object({
    id: z.number().int().positive(),
    publicId: z.string().min(1).max(MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS),
    sourceKey: z.string().min(1).max(MAX_EXTERNAL_SOURCE_KEY_CHARACTERS),
    title: unicodeBoundedString(MAX_EXTERNAL_TITLE_CHARACTERS, 1),
    url: z.url(),
  })
  .strict();

const readDocSectionDataSchema = z
  .object({
    sectionId: z.number().int().positive(),
    found: z.boolean(),
    truncated: z.boolean(),
    characterCount: z.number().int().nonnegative(),
    document: sectionDocumentSchema.nullable(),
    heading: unicodeBoundedString(MAX_EXTERNAL_HEADING_CHARACTERS).nullable(),
    headingPath: unicodeBoundedString(MAX_EXTERNAL_HEADING_PATH_CHARACTERS).nullable(),
    content: z.string(),
  })
  .strict();

const readDocSectionOutputSchema = createToolResponseSchema(
  'read_doc_section',
  readDocSectionDataSchema,
);

type ReadDocSectionData = z.infer<typeof readDocSectionDataSchema>;

export function createMcpServer(dependencies: McpServerV2Dependencies): McpServer {
  const server = createV1McpServer(dependencies);
  registerCatalogResources(server, dependencies.catalogRepository);
  const schemas = createSearchDocsSchemas(
    dependencies.config.limits.defaultSearchResults,
    dependencies.config.limits.maxSearchResults,
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Search local catalog documents',
      description:
        'Search the already ingested local catalog first and return compact ranked section snippets. Prefer 1–3 useful results, then call read_doc_section for the selected section. Use fetch_url only when the needed content is fresh Web content or is not available in the catalog.',
      inputSchema: schemas.input,
      outputSchema: schemas.output.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      return executeToolCall({
        tool: 'search_docs',
        logger: dependencies.logger,
        execute: async () => {
          if (isInvalidToolInput(input)) throw new InvalidArgumentError();
          const output = await dependencies.searchCatalogDocuments.execute({
            query: input.query,
            ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
            ...(input.language === undefined ? {} : { language: input.language }),
            limit: input.maxResults,
          });
          const snippetLimit = input.compact
            ? Math.min(input.maxSnippetChars, 160)
            : input.maxSnippetChars;
          const data = toSearchDocsData(output, snippetLimit);
          return {
            status: 'success',
            warnings: searchDocsWarnings(data),
            cacheStatus: 'DISABLED',
            provider: 'catalog',
            data,
          };
        },
        validateResponse: (response) => {
          schemas.output.parse(response);
          return response;
        },
        formatText: formatSearchDocsText,
      });
    },
  );

  server.registerTool(
    'list_docs',
    {
      title: 'List local catalog documents',
      description:
        'List bounded catalog document metadata only. Use search_docs for content questions; use list_docs only to browse or filter the catalog without loading section content.',
      inputSchema: listDocsInputSchema,
      outputSchema: listDocsOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      return executeToolCall({
        tool: 'list_docs',
        logger: dependencies.logger,
        execute: async () => {
          const data = await listDocs(dependencies.catalogRepository, input);
          return {
            status: 'success',
            warnings: [],
            cacheStatus: 'DISABLED',
            provider: 'catalog',
            data,
          };
        },
        validateResponse: (response) => {
          listDocsOutputSchema.parse(response);
          return response;
        },
        formatText: formatListDocsText,
      });
    },
  );

  server.registerTool(
    'read_doc_section',
    {
      title: 'Read one catalog section',
      description:
        'Read one bounded current catalog section by sectionId, normally after search_docs selected it. Do not enumerate the catalog to answer a content question; search first, then read only the chosen section.',
      inputSchema: readDocSectionInputSchema,
      outputSchema: readDocSectionOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      return executeToolCall({
        tool: 'read_doc_section',
        logger: dependencies.logger,
        execute: async () => {
          const data = await readDocSection(dependencies.catalogRepository, input);
          return {
            status: 'success',
            warnings: data.found
              ? []
              : [{ code: 'NO_RESULTS' as const, message: 'No section matched the id' }],
            cacheStatus: 'DISABLED',
            provider: 'catalog',
            data,
          };
        },
        validateResponse: (response) => {
          readDocSectionOutputSchema.parse(response);
          return response;
        },
        formatText: formatReadDocSectionText,
      });
    },
  );

  return server;
}

function formatSearchDocsText(response: ToolResponse<SearchDocsData>): string {
  const lines = [
    `search_docs ${response.status}: ${response.data.resultCount} result(s)`,
    `requestId=${response.requestId} cache=${response.metadata.cacheStatus}`,
  ];
  response.data.results.forEach((result, index) => {
    const heading = result.headingPath ?? result.heading ?? result.title;
    lines.push(
      `${index + 1}. ${result.title} — ${heading}`,
      `   ${result.url}`,
      `   ${result.snippet}`,
    );
  });
  response.warnings.forEach((warning) =>
    lines.push(`Warning ${warning.code}: ${warning.message}`),
  );
  return lines.join('\n');
}

function formatListDocsText(response: ToolResponse<ListDocsData>): string {
  const lines = [
    `list_docs ${response.status}: ${response.data.count}/${response.data.total} document(s)`,
    `offset=${response.data.offset} limit=${response.data.limit} nextOffset=${response.data.nextOffset ?? 'none'} truncated=${response.data.truncated}`,
  ];
  response.data.documents.forEach((document, index) => {
    lines.push(
      `${index + 1}. ${document.title}`,
      `   ${document.url}`,
      `   ${document.sourceKey} · ${document.publicId}`,
    );
  });
  return lines.join('\n');
}

function formatReadDocSectionText(response: ToolResponse<ReadDocSectionData>): string {
  if (!response.data.found || response.data.document === null) {
    return `read_doc_section ${response.status}: no section found for ${response.data.sectionId}`;
  }
  return [
    `read_doc_section ${response.status}: ${response.data.document.title}`,
    `sectionId=${response.data.sectionId} truncated=${response.data.truncated}`,
    response.data.headingPath ?? response.data.heading ?? response.data.document.title,
    response.data.document.url,
    response.data.content,
  ].join('\n');
}

function toSearchDocsData(
  output: SearchCatalogDocumentsOutput,
  snippetLimit: number,
): SearchDocsData {
  return {
    query: output.query,
    resultCount: output.resultCount,
    results: output.results.map((result) => ({
      ...result,
      snippet: truncateUnicode(result.snippet, snippetLimit),
    })),
  };
}

async function listDocs(
  repository: CatalogRepository,
  input: z.infer<typeof listDocsInputSchema>,
): Promise<ListDocsData> {
  const page = await repository.listDocumentsPage({
    offset: input.offset,
    limit: input.limit,
    ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.status === undefined ? {} : { status: input.status }),
  });
  const budgeted = applyListDocsBudget(
    page.items.map(({ source, document }) => toCompactDocument(document, source.sourceKey)),
    page.offset,
    page.limit,
    page.total,
  );
  return {
    count: budgeted.documents.length,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    nextOffset: budgeted.nextOffset,
    truncated: budgeted.truncated,
    documents: budgeted.documents,
  };
}

async function readDocSection(
  repository: CatalogRepository,
  input: z.infer<typeof readDocSectionInputSchema>,
): Promise<ReadDocSectionData> {
  const entry = await repository.getCurrentDocumentSectionById(input.sectionId);
  if (entry === undefined) {
    return {
      sectionId: input.sectionId,
      found: false,
      truncated: false,
      characterCount: 0,
      document: null,
      heading: null,
      headingPath: null,
      content: '',
    };
  }
  const content = truncateUnicode(entry.section.content, input.maxCharacters);
  const publicId = boundedNonEmpty(
    entry.document.publicId,
    MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
    `document-${entry.document.id}`,
  );
  return {
    sectionId: input.sectionId,
    found: true,
    truncated: countUnicodeCharacters(content) < countUnicodeCharacters(entry.section.content),
    characterCount: countUnicodeCharacters(content),
    document: {
      id: entry.document.id,
      publicId,
      sourceKey: boundedNonEmpty(
        entry.source.sourceKey,
        MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
        'catalog',
      ),
      title: boundedNonEmpty(entry.document.title, MAX_EXTERNAL_TITLE_CHARACTERS, publicId),
      url: entry.document.canonicalUrl,
    },
    heading:
      entry.section.heading === undefined
        ? null
        : truncateUnicode(entry.section.heading, MAX_EXTERNAL_HEADING_CHARACTERS),
    headingPath:
      entry.section.headingPath === undefined
        ? null
        : truncateUnicode(entry.section.headingPath, MAX_EXTERNAL_HEADING_PATH_CHARACTERS),
    content,
  };
}

function toCompactDocument(document: CatalogDocument, sourceKey: string) {
  const publicId = boundedNonEmpty(
    document.publicId,
    MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
    `document-${document.id}`,
  );
  return {
    id: document.id,
    publicId,
    sourceKey: boundedNonEmpty(sourceKey, MAX_EXTERNAL_SOURCE_KEY_CHARACTERS, 'catalog'),
    title: boundedNonEmpty(document.title, MAX_EXTERNAL_TITLE_CHARACTERS, publicId),
    url: document.canonicalUrl,
    language: boundedNonEmpty(document.language, MAX_EXTERNAL_LANGUAGE_CHARACTERS, 'und'),
    status: document.status,
    currentVersionId: document.currentVersionId ?? null,
  };
}

function applyListDocsBudget(
  documents: readonly ReturnType<typeof toCompactDocument>[],
  offset: number,
  limit: number,
  total: number,
): {
  readonly documents: ReturnType<typeof toCompactDocument>[];
  readonly nextOffset: number | null;
  readonly truncated: boolean;
} {
  const accepted: ReturnType<typeof toCompactDocument>[] = [];
  for (const document of documents) {
    const candidate = [...accepted, document];
    const candidateNextOffset =
      offset + candidate.length < total ? offset + candidate.length : null;
    const candidateLength = countUnicodeCharacters(
      JSON.stringify({
        count: candidate.length,
        total,
        offset,
        limit,
        nextOffset: candidateNextOffset,
        truncated: candidate.length < documents.length,
        documents: candidate,
      }),
    );
    if (candidateLength > MAX_LIST_DOCS_DATA_CHARACTERS) {
      if (accepted.length === 0) {
        throw new ResponseTooLargeError(
          'One catalog document exceeds the list_docs response budget',
        );
      }
      break;
    }
    accepted.push(document);
  }
  const nextOffset = offset + accepted.length < total ? offset + accepted.length : null;
  return {
    documents: accepted,
    nextOffset,
    truncated: accepted.length < documents.length,
  };
}

function searchDocsWarnings(data: SearchDocsData): readonly ToolWarningDescriptor[] {
  if (data.resultCount > 0) return [];
  return [
    {
      code: 'NO_RESULTS',
      message: 'No catalog document matched the query',
    },
  ];
}

function boundedNonEmpty(value: string, maximumCharacters: number, fallback: string): string {
  const trimmed = value.trim();
  return truncateUnicode(trimmed === '' ? fallback : trimmed, maximumCharacters);
}
