import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type {
  SearchCatalogDocuments,
  SearchCatalogDocumentsOutput,
} from '../../application/use-cases/search-catalog-documents.js';
import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';
import type { ToolResponse, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import type { ApplicationConfig } from '../../infrastructure/config/application-config.js';
import type { Logger } from '../../application/ports/logger.js';
import type { McpServerDependencies as V1McpServerDependencies } from './mcp-server.js';
import { createMcpServer as createV1McpServer } from './mcp-server.js';
import { isInvalidToolInput } from './schemas/invalid-tool-input.js';
import { createSearchDocsSchemas } from './schemas/search-docs-schema.js';
import { executeToolCall } from './tool-call.js';

export interface McpServerV2Dependencies extends V1McpServerDependencies {
  readonly searchCatalogDocuments: SearchCatalogDocuments;
  readonly config: ApplicationConfig;
  readonly logger: Logger;
}

type SearchDocsData = Omit<SearchCatalogDocumentsOutput, 'schemaVersion'>;

export function createMcpServer(dependencies: McpServerV2Dependencies): McpServer {
  const server = createV1McpServer(dependencies);
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
          const data = toSearchDocsData(output);
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

function toSearchDocsData(output: SearchCatalogDocumentsOutput): SearchDocsData {
  return {
    query: output.query,
    resultCount: output.resultCount,
    results: output.results,
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
