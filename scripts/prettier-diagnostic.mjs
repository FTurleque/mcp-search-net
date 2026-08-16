import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const candidates = [
  'docs/reference/catalog-sync-v2.md',
  'docs/status/current-state.md',
  'src/application/use-cases/sync-catalog-documents.ts',
  'src/cli/catalog-source-config.ts',
  'src/cli/catalog.ts',
  'src/infrastructure/locking/file-lease-lock.ts',
  'tests/application/sync-catalog-documents.test.ts',
  'tests/cli/catalog-source-config.test.ts',
  'tests/cli/catalog-sync-guards.test.ts',
  'tests/infrastructure/file-lease-lock.test.ts',
];

const before = new Map(candidates.map((file) => [file, readFileSync(file, 'utf8')]));
const prettier = resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prettier.cmd' : 'prettier',
);
execFileSync(prettier, ['--write', ...candidates], { stdio: 'inherit' });

let changed = 0;
for (const file of candidates) {
  const after = readFileSync(file, 'utf8');
  if (after === before.get(file)) continue;
  changed += 1;
  const encoded = Buffer.from(after, 'utf8').toString('base64');
  process.stdout.write(`::error file=${file},title=PRETTIER_FORMAT::${encoded}\n`);
}

if (changed > 0) {
  process.stderr.write(`Prettier would modify ${changed} file(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Prettier diagnostic: all candidate files are already formatted.\n');
}
