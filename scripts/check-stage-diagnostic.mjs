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

let changed = 0;
for (const file of files) {
  const diff = execFileSync('git', ['diff', '--', file], { encoding: 'utf8' });
  if (diff.length === 0) continue;
  changed += 1;
  process.stdout.write(
    `::error file=${file},title=PRETTIER_DIFF::${Buffer.from(diff, 'utf8').toString('base64')}\n`,
  );
}

if (changed > 0) {
  process.stderr.write(`Prettier would modify ${changed} source file(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Prettier diagnostic: source files are formatted.\n');
}
