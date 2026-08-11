import { cpSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const files = [
  'docs/status/current-state.md',
  'src/infrastructure/catalog/catalog-row-mappers.ts',
  'src/infrastructure/catalog/sqlite-catalog-revision-writer.ts',
  'src/infrastructure/catalog/sqlite-catalog-search.ts',
  'src/infrastructure/search/searxng-search-provider.ts',
  'src/presentation/mcp/catalog-resources.ts',
  'tests/e2e/mcp-stdio.test.ts',
  'tests/infrastructure/catalog-migration-runner.test.ts',
  'tests/infrastructure/followup-audit-regressions.test.ts',
];

copyFiles('original');
execFileSync(resolve('node_modules/.bin/prettier'), ['--write', '.'], { stdio: 'inherit' });
copyFiles('formatted');
process.exitCode = 1;

function copyFiles(kind) {
  for (const file of files) {
    const destination = resolve('.data/test-reports/prettier', kind, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(file), destination);
  }
}
