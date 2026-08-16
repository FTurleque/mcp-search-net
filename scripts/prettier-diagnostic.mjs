import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const candidates = [
  'tests/application/sync-catalog-documents.test.ts',
  'tests/cli/catalog-sync-guards.test.ts',
];
const prettier = resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prettier.cmd' : 'prettier',
);
execFileSync(prettier, ['--write', ...candidates], { stdio: 'inherit' });

let changed = 0;
for (const file of candidates) {
  const diff = execFileSync('git', ['diff', '--', file], { encoding: 'utf8' });
  if (diff.length === 0) continue;
  changed += 1;
  const encoded = Buffer.from(diff, 'utf8').toString('base64');
  process.stdout.write(`::error file=${file},title=PRETTIER_DIFF::${encoded}\n`);
}

if (changed > 0) {
  process.stderr.write(`Prettier would modify ${changed} file(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Prettier diagnostic: both remaining files are formatted.\n');
}
