import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

import { DisabledSearchHistoryRepository } from '../../src/application/ports/search-history-repository.js';
import { ListSearchHistory } from '../../src/application/use-cases/list-search-history.js';
import type { Logger } from '../../src/application/ports/logger.js';
import { registerSearchHistoryTool } from '../../src/presentation/mcp/search-history-tool.js';
import { applicationConfigSchema } from '../../src/infrastructure/config/application-config.js';

const logger = {} as Logger;

describe('search history exposure policy', () => {
  it('defaults history tool exposure to false for legacy configurations', () => {
    const config = applicationConfigSchema.parse({});
    expect(config.history.exposeTool).toBe(false);
  });

  it('does not register list_search_history when exposure is disabled', () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;
    const useCase = new ListSearchHistory(new DisabledSearchHistoryRepository(), false);

    registerSearchHistoryTool(server, useCase, logger);

    expect(registerTool).not.toHaveBeenCalled();
  });

  it('keeps the history tool available when exposure is explicitly enabled', () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;
    const useCase = new ListSearchHistory(new DisabledSearchHistoryRepository(), true);

    registerSearchHistoryTool(server, useCase, logger);

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toBe('list_search_history');
  });
});
