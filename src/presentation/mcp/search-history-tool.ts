import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Logger } from '../../application/ports/logger.js';
import type {
  ListSearchHistory,
  ListSearchHistoryOutput,
} from '../../application/use-cases/list-search-history.js';
import type { ToolResponse, ToolWarningDescriptor } from '../../domain/models/tool-response.js';
import { executeToolCall } from './tool-call.js';
import {
  listSearchHistoryInputSchema,
  listSearchHistoryOutputSchema,
} from './schemas/search-history-schema.js';

export function registerSearchHistoryTool(
  server: McpServer,
  listSearchHistory: ListSearchHistory,
  logger: Logger,
): void {
  if (!listSearchHistory.exposed) return;

  server.registerTool(
    'list_search_history',
    {
      title: 'List local MCP search history',
      description:
        'Liste de manière bornée et paginée les recherches search_web et search_docs enregistrées localement. Utiliser cet outil pour inspecter l’historique d’utilisation du MCP sans relancer de recherche Web.',
      inputSchema: listSearchHistoryInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      return executeToolCall({
        tool: 'list_search_history',
        logger,
        execute: async () => {
          const data = await listSearchHistory.execute({
            ...(input.tool === undefined ? {} : { tool: input.tool }),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.cacheStatus === undefined ? {} : { cacheStatus: input.cacheStatus }),
            ...(input.from === undefined ? {} : { from: new Date(input.from) }),
            ...(input.to === undefined ? {} : { to: new Date(input.to) }),
            ...(input.queryContains === undefined ? {} : { queryContains: input.queryContains }),
            limit: input.limit,
            ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
          });
          const warnings = historyWarnings(data);
          return {
            status: data.available ? 'success' : 'partial',
            warnings,
            cacheStatus: 'DISABLED',
            provider: 'history',
            data,
          };
        },
        validateResponse: (response) => {
          listSearchHistoryOutputSchema.parse(response);
          return response;
        },
        formatText: formatSearchHistoryText,
      });
    },
  );
}

type SearchHistoryData = ListSearchHistoryOutput;

function historyWarnings(data: SearchHistoryData): readonly ToolWarningDescriptor[] {
  if (!data.enabled) {
    return [{ code: 'HISTORY_DISABLED', message: 'Persistent search history is disabled' }];
  }
  if (!data.available) {
    return [{ code: 'HISTORY_UNAVAILABLE', message: 'Persistent search history is unavailable' }];
  }
  if (data.count === 0) {
    return [{ code: 'NO_RESULTS', message: 'No search history entry matched the filters' }];
  }
  return [];
}

function formatSearchHistoryText(response: ToolResponse<SearchHistoryData>): string {
  const lines = [
    `list_search_history ${response.status}: ${response.data.count}/${response.data.total} entrie(s)`,
    `enabled=${response.data.enabled} available=${response.data.available} nextBeforeId=${response.data.nextBeforeId ?? 'none'}`,
  ];
  response.data.searches.forEach((entry, index) => {
    lines.push(
      `${index + 1}. [${entry.tool}] ${entry.query}`,
      `   ${entry.executedAt} · ${entry.status} · ${entry.cacheStatus ?? 'n/a'} · ${entry.resultCount ?? 0} result(s)`,
      `   requestId=${entry.requestId} provider=${entry.provider} durationMs=${entry.durationMs}`,
    );
  });
  response.warnings.forEach((warning) => lines.push(`Warning ${warning.code}: ${warning.message}`));
  return lines.join('\n');
}
