import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type { Logger } from '../../application/ports/logger.js';
import type { FetchUrl } from '../../application/use-cases/fetch-url.js';
import type { ListSearchHistory } from '../../application/use-cases/list-search-history.js';
import type { SearchWeb } from '../../application/use-cases/search-web.js';
import { registerCatalogResources } from './catalog-resources.js';
import type { SearchCatalogDocumentsExecutor } from './catalog-tools-registration.js';
import { registerCatalogTools } from './catalog-tools-registration.js';
import { registerSearchHistoryTool } from './search-history-tool.js';
import { registerWebTools } from './web-tools-registration.js';

export interface McpPresentationConfig {
  readonly application: {
    readonly name: string;
    readonly version: string;
  };
  readonly limits: {
    readonly defaultSearchResults: number;
    readonly maxSearchResults: number;
    readonly defaultFetchChars: number;
    readonly maxFetchChars: number;
    readonly defaultFetchSections: number;
    readonly maxFetchSections: number;
  };
}

export interface McpServerDependencies {
  readonly searchWeb: SearchWeb;
  readonly fetchUrl: FetchUrl;
  readonly catalogRepository: CatalogRepository;
  readonly searchCatalogDocuments: SearchCatalogDocumentsExecutor;
  readonly listSearchHistory: ListSearchHistory;
  readonly config: McpPresentationConfig;
  readonly logger: Logger;
}

export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const server = new McpServer({
    name: dependencies.config.application.name,
    version: dependencies.config.application.version,
  });
  registerWebTools(server, dependencies);
  registerCatalogTools(server, dependencies);
  registerCatalogResources(server, dependencies.catalogRepository);
  registerSearchHistoryTool(server, dependencies.listSearchHistory, dependencies.logger);
  return server;
}

export async function connectStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
