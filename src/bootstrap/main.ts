import { resolve } from 'node:path';

import { createContainer } from './container.js';
import { assertSupportedNodeVersion } from './runtime-guard.js';
import { loadConfiguration } from '../infrastructure/config/load-configuration.js';
import { StructuredLogger } from '../infrastructure/logging/structured-logger.js';
import { connectStdio } from '../presentation/mcp/mcp-server.js';

async function main(): Promise<void> {
  assertSupportedNodeVersion(process.versions.node);
  loadLocalEnvironment();
  const configPath =
    process.env['MCP_CONFIG_PATH'] ??
    process.env['MCP_SEARCH_CONFIG'] ??
    resolve('config/application.yml');
  const loaded = await loadConfiguration(configPath);
  const container = createContainer(loaded);

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.record('server_stopped', { reason, exitCode });
    await container.mcpServer.close().catch(() => undefined);
    container.cache.close();
    container.catalog.close();
    container.history.close();
    process.exitCode = exitCode;
  };
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('uncaughtException', (error) => {
    container.logger.error('uncaught_exception', { error });
    void shutdown('uncaughtException', 1);
  });
  process.once('unhandledRejection', (reason) => {
    container.logger.error('unhandled_rejection', { reason });
    void shutdown('unhandledRejection', 1);
  });
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') void shutdown('EPIPE');
    else {
      container.logger.error('stdout_error', { error });
      void shutdown('stdoutError', 1);
    }
  });
  process.once('exit', () => {
    container.cache.close();
    container.catalog.close();
    container.history.close();
  });

  container.logger.record('server_started', {
    name: loaded.application.application.name,
    version: loaded.application.application.version,
  });
  await connectStdio(container.mcpServer);
}

function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile(resolve('.env'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

main().catch((error: unknown) => {
  const logger = new StructuredLogger('error');
  logger.record('configuration_invalid', {
    error: error instanceof Error ? { name: error.name } : 'unknown',
  });
  logger.error('Fatal bootstrap error', { error: error instanceof Error ? error : String(error) });
  process.exitCode = 1;
});
