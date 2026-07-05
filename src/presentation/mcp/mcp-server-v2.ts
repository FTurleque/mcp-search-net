import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type {
  SearchCatalogDocuments,
  SearchCatalogDocumentsOutput,
} from '../../application/use-cases/search-catalog-documents.js';
import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';
import type { CatalogCurrentDocumentSection, CatalogDocument } from '../../domain/models/catalog.js';
import type { ToolResponse, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import type { ApplicationConfig } from '../../infrastructure/config/application-config.js';
import type { Logger } from '../../application/ports/logger.js';
import { registerCatalogResources } from './catalog-resources.js';
import type { McpServerDependencies as V1McpServerDependencies } from './mcp-server.js';
import { createMcpServer as createV1McpServer } from './mcp-server.js';
import { isInvalidToolInput } from './schemas/invalid-tool-input.js';
import { createSearchDocsSchemas } from './schemas/search-docs-schema.js';
import { createToolResponseSchema } from './schemas/tool-response-schema.js';
import { executeToolCall } from './tool-call.js';

export interface McpServerV2Dependencies extends V1McpServerDependencies {
  readonly catalogRepository: CatalogRepository;
  readonly searchCatalogDocuments: SearchCatalogDocuments;
  readonly config: ApplicationConfig;
  readonly logger: Logger;
}

type SearchDocsData = Omit<SearchCatalogDocumentsOutput, 'schemaVersion'>;

const compactDocumentSchema = z
  .object({
    id: z.number().int().positive(),
    publicId: z.string().min(1),
    sourceKey: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    language: z.string().min(1),
    status: z.string().min(1),
    currentVersionId: z.number().int().positive().nullable(),
  })
  .strict();

const listDocsInputSchema = z
  .object({
    sourceKey: z.string().trim().min(1).max(128).optional(),
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
    publicId: z.string().min(1),
    sourceKey: z.string().min(1),
    title: z.string().min(1),
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
    heading: z.string().nullable(),
    headingPath: z.string().nullable(),
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
      description: 'Search already ingested catalog documents.',
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
      description: 'List catalog documents without section content.',
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
      description: 'Read one catalog section by id with a character budget.',
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
            warnings: data.found ? [] : [{ code: 'NO_RESULTS' as const, message: 'No section matched the id' }],
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
    lines.push(`${index + 1}. ${result.title} — ${heading}`, `   ${result.url}`, `   ${result.snippet}`);
  });
  response.warnings.forEach((warning) => lines.push(`Warning ${warning.code}: ${warning.message}`));
  return lines.join('\n');
}

function formatListDocsText(response: ToolResponse<ListDocsData>): string {
  const lines = [
    `list_docs ${response.status}: ${response.data.count}/${response.data.total} document(s)`,
    `offset=${response.data.offset} limit=${response.data.limit}`,
  ];
  response.data.documents.forEach((document, index) => {
    lines.push(`${index + 1}. ${document.title}`, `   ${document.url}`, `   ${document.sourceKey} · ${document.publicId}`);
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

function toSearchDocsData(output: SearchCatalogDocumentsOutput, snippetLimit: number): SearchDocsData {
  return {
    query: output.query,
    resultCount: output.resultCount,
    results: output.results.map((result) => ({
      ...result,
      snippet: truncateText(result.snippet, snippetLimit),
    })),
  };
}

async function listDocs(
  repository: CatalogRepository,
  input: z.infer<typeof listDocsInputSchema>,
): Promise<ListDocsData> {
  const [sources, documents] = await Promise.all([repository.listSources(), repository.listDocuments()]);
  const sourceKeys = new Map(sources.map((source) => [source.id, source.sourceKey] as const));
  const filtered = documents.filter((document) => {
    if (input.sourceKey === undefined) return true;
    return sourceKeys.get(document.sourceId) === input.sourceKey;
  });
  const page = filtered.slice(input.offset, input.offset + input.limit);
  return {
    count: page.length,
    total: filtered.length,
    offset: input.offset,
    limit: input.limit,
    documents: page.map((document) => toCompactDocument(document, sourceKeys.get(document.sourceId) ?? 'unknown')),
  };
}

async function readDocSection(
  repository: CatalogRepository,
  input: z.infer<typeof readDocSectionInputSchema>,
): Promise<ReadDocSectionData> {
  const sections = await repository.listCurrentDocumentSections();
  const entry = sections.find((candidate) => candidate.section.id === input.sectionId);
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
  const content = truncateText(entry.section.content, input.maxCharacters);
  return {
    sectionId: input.sectionId,
    found: true,
    truncated: content.length < entry.section.content.length,
    characterCount: content.length,
    document: {
      id: entry.document.id,
      publicId: entry.document.publicId,
      sourceKey: entry.source.sourceKey,
      title: entry.document.title,
      url: entry.document.canonicalUrl,
    },
    heading: entry.section.heading ?? null,
    headingPath: entry.section.headingPath ?? null,
    content,
  };
}

function toCompactDocument(document: CatalogDocument, sourceKey: string) {
  return {
    id: document.id,
    publicId: document.publicId,
    sourceKey,
    title: document.title,
    url: document.canonicalUrl,
    language: document.language,
    status: document.status,
    currentVersionId: document.currentVersionId ?? null,
  };
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
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
