import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const files = [
  'src/cli/catalog.ts',
  'src/infrastructure/locking/file-lease-lock.ts',
];
const prettier = resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prettier.cmd' : 'prettier',
);
execFileSync(prettier, ['--write', ...files], { stdio: 'inherit' });

for (const file of files) {
  const encoded = Buffer.from(readFileSync(file, 'utf8'), 'utf8').toString('base64');
  process.stdout.write(`::error file=${file},title=FORMATTED_FILE::${encoded}\n`);
}
process.exitCode = 1;
