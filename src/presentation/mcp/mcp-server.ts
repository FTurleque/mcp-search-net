import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { FetchUrl } from '../../application/use-cases/fetch-url.js';
import type { SearchWeb } from '../../application/use-cases/search-web.js';
import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';
import type { FetchResponse } from '../../domain/models/content.js';
import type { SearchResponse } from '../../domain/models/search.js';
import type { ToolResponse } from '../../domain/models/tool-response.js';
import type { ApplicationConfig } from '../../infrastructure/config/application-config.js';
import type { StructuredLogger } from '../../infrastructure/logging/structured-logger.js';
import { createFetchUrlSchemas } from './schemas/fetch-url-schema.js';
import { isInvalidToolInput } from './schemas/invalid-tool-input.js';
import { createSearchWebSchemas } from './schemas/search-web-schema.js';
import { executeToolCall } from './tool-call.js';

export interface McpServerDependencies {
  readonly searchWeb: SearchWeb;
  readonly fetchUrl: FetchUrl;
  readonly config: ApplicationConfig;
  readonly logger: StructuredLogger;
}

export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const server = new McpServer({
    name: dependencies.config.application.name,
    version: dependencies.config.application.version,
  });
  const searchSchemas = createSearchWebSchemas(
    dependencies.config.limits.defaultSearchResults,
    dependencies.config.limits.maxSearchResults,
  );
  const fetchSchemas = createFetchUrlSchemas(
    dependencies.config.limits.defaultFetchChars,
    dependencies.config.limits.maxFetchChars,
    dependencies.config.limits.defaultFetchSections,
    dependencies.config.limits.maxFetchSections,
  );

  server.registerTool(
    'search_web',
    {
      title: 'Search the public Web',
      description:
        'Recherche des pages Web à partir de termes, privilégie les sources officielles et retourne une liste limitée de résultats avec leurs URL. Utiliser cet outil pour découvrir des sources. Ne pas l’utiliser pour lire le contenu complet d’une URL déjà connue.',
      inputSchema: searchSchemas.input,
      outputSchema: searchSchemas.output.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      return executeToolCall({
        tool: 'search_web',
        logger: dependencies.logger,
        execute: async (requestId) => {
          if (isInvalidToolInput(input)) throw new InvalidArgumentError();
          return dependencies.searchWeb.execute(
            {
              query: input.query,
              sourcePolicy: input.sourcePolicy,
              allowedDomains: input.allowedDomains,
              excludedDomains: input.excludedDomains,
              language: input.language,
              ...(input.timeRange === undefined ? {} : { timeRange: input.timeRange }),
              maxResults: input.maxResults,
            },
            { requestId },
          );
        },
        validateResponse: (response) => {
          searchSchemas.output.parse(response);
          return response;
        },
        formatText: formatSearchText,
      });
    },
  );

  server.registerTool(
    'fetch_url',
    {
      title: 'Fetch a public URL',
      description:
        'Récupère une URL publique validée et retourne uniquement les sections pertinentes avec les métadonnées de source. Utiliser cet outil lorsqu’une URL est déjà connue. Il ne suit pas les liens, ne réalise pas de crawl et n’exécute aucun script fourni par l’appelant.',
      inputSchema: fetchSchemas.input,
      outputSchema: fetchSchemas.output.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      return executeToolCall({
        tool: 'fetch_url',
        logger: dependencies.logger,
        execute: async (requestId) => {
          if (isInvalidToolInput(input)) throw new InvalidArgumentError();
          return dependencies.fetchUrl.execute(
            {
              url: input.url,
              ...(input.query === undefined ? {} : { query: input.query }),
              maxCharacters: input.maxCharacters,
              maxSections: input.maxSections,
              renderMode: input.renderMode,
            },
            { requestId },
          );
        },
        validateResponse: (response) => {
          fetchSchemas.output.parse(response);
          return response;
        },
        formatText: formatFetchText,
      });
    },
  );

  return server;
}

export async function connectStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

function formatSearchText(response: ToolResponse<SearchResponse>): string {
  const lines = [
    `search_web ${response.status}: ${response.data.results.length} result(s)`,
    `requestId=${response.requestId} cache=${response.metadata.cacheStatus}`,
  ];
  response.data.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`, `   ${result.url}`);
  });
  response.warnings.forEach((warning) => lines.push(`Warning ${warning.code}: ${warning.message}`));
  return lines.join('\n');
}

function formatFetchText(response: ToolResponse<FetchResponse>): string {
  const heading = response.data.title ?? response.data.finalUrl;
  const lines = [
    `fetch_url ${response.status}: ${heading}`,
    `requestId=${response.requestId} cache=${response.metadata.cacheStatus}`,
    `Source: ${response.data.finalUrl}`,
  ];
  response.warnings.forEach((warning) => lines.push(`Warning ${warning.code}: ${warning.message}`));
  lines.push('', response.data.markdown);
  return lines.join('\n');
}
