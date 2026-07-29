import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const [suite, config, ...vitestArguments] = process.argv.slice(2);
if (!suite || !config) throw new Error('Usage: run-test-suite.mjs <suite> <vitest-config>');

const reportDirectory = resolve('.data/test-reports');
const reportPath = resolve(reportDirectory, `${suite}.json`);
mkdirSync(reportDirectory, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    resolve('node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    config,
    ...vitestArguments,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ],
  { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const skipped = Number(report.numPendingTests ?? 0);
const failed = Number(report.numFailedTests ?? 0);
const passed = Number(report.numPassedTests ?? 0);
if (skipped > 0 || failed > 0 || passed === 0) {
  process.stderr.write(
    `Required suite ${suite} rejected: passed=${passed} failed=${failed} skipped=${skipped}\n`,
  );
  process.exit(1);
}
process.stdout.write(`REQUIRED_SUITE_VALID ${suite}: ${passed} passed, 0 skipped\n`);
