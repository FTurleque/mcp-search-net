import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const file = 'tests/application/sync-catalog-resume-fingerprint.test.ts';
const prettier = resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prettier.cmd' : 'prettier',
);
execFileSync(prettier, ['--write', file], { stdio: 'inherit' });
const diff = execFileSync('git', ['diff', '--', file], { encoding: 'utf8' });
if (diff.length === 0) {
  process.stdout.write('Resume fingerprint test is formatted.\n');
} else {
  process.stdout.write(
    `::error file=${file},title=PRETTIER_DIFF::${Buffer.from(diff, 'utf8').toString('base64')}\n`,
  );
  process.exitCode = 1;
}
