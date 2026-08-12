import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.data/test-reports/prettier');
const files = [
  'scripts/check-audit-invariants.mjs',
  'src/infrastructure/catalog/catalog-sql.ts',
  'tests/infrastructure/sqlite-catalog-repository.test.ts',
];

mkdirSync(output, { recursive: true });
for (const file of files) {
  copyFileSync(resolve(root, file), resolve(output, basename(file)));
}

process.exitCode = 1;
