import { resolve } from 'node:path';

import { createContainer } from './container.js';
import { loadConfiguration } from '../infrastructure/config/load-configuration.js';
import { StructuredLogger } from '../infrastructure/logging/structured-logger.js';
import { connectStdio } from '../presentation/mcp/mcp-server.js';

async function main(): Promise<void> {
  assertSupportedNode();
  const configPath = process.env['MCP_SEARCH_CONFIG'] ?? resolve('config/application.yml');
  const loaded = await loadConfiguration(configPath);
  const container = createContainer(loaded);

  const shutdown = (): void => {
    container.logger.info('MCP server shutting down');
    container.cache.close();
  };
  process.once('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
  process.once('exit', () => container.cache.close());

  container.logger.info('MCP server starting', {
    name: loaded.application.application.name,
    version: loaded.application.application.version,
  });
  await connectStdio(container.mcpServer);
}

function assertSupportedNode(): void {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major !== 24) {
    throw new Error(`Node.js 24 LTS is required; current runtime is ${process.versions.node}`);
  }
}

main().catch((error: unknown) => {
  const logger = new StructuredLogger('error');
  logger.error('Fatal bootstrap error', { error: error instanceof Error ? error : String(error) });
  process.exitCode = 1;
});
