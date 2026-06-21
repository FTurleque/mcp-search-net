import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { FetchUrl } from '../../application/use-cases/fetch-url.js';
import type { SearchWeb } from '../../application/use-cases/search-web.js';
import { ApplicationError } from '../../domain/errors/domain-errors.js';
import type { ApplicationConfig } from '../../infrastructure/config/application-config.js';
import type { StructuredLogger } from '../../infrastructure/logging/structured-logger.js';
import { createFetchUrlSchemas } from './schemas/fetch-url-schema.js';
import { createSearchWebSchemas } from './schemas/search-web-schema.js';

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
  );

  server.registerTool(
    'search_web',
    {
      title: 'Search the public Web',
      description:
        'Search public web pages through a local SearXNG instance. Official documentation sources are ranked first and all results preserve their URLs and provenance.',
      inputSchema: searchSchemas.input.shape,
      outputSchema: searchSchemas.output.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const output = searchSchemas.output.parse(
          await dependencies.searchWeb.execute({
            query: input.query,
            ...(input.language === undefined ? {} : { language: input.language }),
            ...(input.timeRange === undefined ? {} : { timeRange: input.timeRange }),
            maxResults: input.maxResults,
            officialOnly: input.officialOnly,
          }),
        );
        dependencies.logger.info('search_web completed', {
          resultCount: output.results.length,
          cached: output.metadata.cached,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError('search_web', error, dependencies.logger);
      }
    },
  );

  server.registerTool(
    'fetch_url',
    {
      title: 'Fetch a public URL',
      description:
        'Fetch one known public HTTP(S) URL through the local Crawl4AI service, preserve metadata and links, select relevant Markdown sections, and enforce a strict content budget.',
      inputSchema: fetchSchemas.input.shape,
      outputSchema: fetchSchemas.output.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const output = fetchSchemas.output.parse(
          await dependencies.fetchUrl.execute({
            url: input.url,
            ...(input.query === undefined ? {} : { query: input.query }),
            maxChars: input.maxChars,
          }),
        );
        dependencies.logger.info('fetch_url completed', {
          cached: output.metadata.cached,
          truncated: output.metadata.truncated,
          outputChars: output.markdown.length,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError('fetch_url', error, dependencies.logger);
      }
    },
  );

  return server;
}

export async function connectStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

function toolError(tool: string, error: unknown, logger: StructuredLogger) {
  const message = error instanceof ApplicationError ? error.message : 'Unexpected internal error';
  const code = error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR';
  logger.error(`${tool} failed`, { code, error: error instanceof Error ? error : String(error) });
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}
