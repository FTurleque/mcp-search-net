import process from 'node:process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [launcher, installRoot] = process.argv.slice(2);
if (!launcher || !installRoot) {
  throw new Error('Usage: probe-installed-mcp.mjs <launcher.cmd> <install-root>');
}
const resolvedInstallRoot = resolve(installRoot);
const resolvedLauncher = resolve(launcher);
const launcherRelativePath = relative(resolvedInstallRoot, resolvedLauncher);
const expectedLauncherRelativePath = join('bin', 'mcp-search-net.cmd');
if (
  launcherRelativePath.toLowerCase() !== expectedLauncherRelativePath.toLowerCase() ||
  launcherRelativePath.startsWith(`..${sep}`) ||
  isAbsolute(launcherRelativePath) ||
  !existsSync(resolvedLauncher)
) {
  throw new Error('INSTALLED_LAUNCHER_PATH_INVALID');
}

const requestTimeoutMs = 30_000;

const client = new Client({ name: 'mcp-search-net-installed-probe', version: '1.1.5' });
const transport = new StdioClientTransport({
  command: resolvedLauncher,
  cwd: resolvedInstallRoot,
  env: {
    ...process.env,
    MCP_SEARCH_HOME: resolvedInstallRoot,
  },
  maxBufferSize: 1_048_576,
  stderr: 'inherit',
});

try {
  await client.connect(transport, { timeout: requestTimeoutMs });
  const tools = await client.listTools({}, { timeout: requestTimeoutMs });
  const names = tools.tools.map((tool) => tool.name).sort();
  const expected = ['fetch_url', 'list_docs', 'read_doc_section', 'search_docs', 'search_web'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`INSTALLED_TOOL_INVENTORY_MISMATCH:${names.join(',')}`);
  }
  if (names.includes('list_search_history')) {
    throw new Error('INSTALLED_HISTORY_TOOL_MUST_BE_OPT_IN');
  }
  const listed = await client.callTool({ name: 'list_docs', arguments: { limit: 1 } }, undefined, {
    timeout: requestTimeoutMs,
  });
  if (listed.isError === true || listed.structuredContent?.schemaVersion !== '1.0') {
    throw new Error('INSTALLED_LIST_DOCS_CONTRACT_INVALID');
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'INSTALLED_STDIO_VALID',
      tools: names,
      historyExposed: false,
      schemaVersion: '1.0',
    })}\n`,
  );
} finally {
  await client.close();
}
