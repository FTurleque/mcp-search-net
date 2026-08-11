import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { format, resolveConfig } from 'prettier';

const files = [
  'src/presentation/mcp/catalog-resources.ts',
  'src/presentation/mcp/mcp-server-v2.ts',
  'tests/infrastructure/final-audit-regressions.test.ts',
  'tests/presentation/final-audit-mcp.test.ts',
];
const outputDirectory = '.data/test-reports/prettier-final-audit';
await mkdir(outputDirectory, { recursive: true });

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const config = (await resolveConfig(file)) ?? {};
  const formatted = await format(source, { ...config, filepath: file });
  await writeFile(join(outputDirectory, basename(file)), formatted, 'utf8');
}

process.stderr.write('PRETTIER_AUDIT_OUTPUT_CAPTURED\n');
process.exitCode = 1;
