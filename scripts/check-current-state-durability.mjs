import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import * as prettier from 'prettier';

const targets = [
  'tests/cli/catalog-fts-content-integrity-preflight.test.ts',
  'tests/infrastructure/catalog-fts-content-integrity.test.ts',
  'tests/infrastructure/sqlite-catalog-backup-cleanup.test.ts',
];

for (const target of targets) {
  const path = resolve(target);
  const source = readFileSync(path, 'utf8');
  const config = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: path });
  process.stdout.write(`PRETTIER_BEGIN ${target}\n`);
  process.stdout.write(`${Buffer.from(formatted, 'utf8').toString('base64')}\n`);
  process.stdout.write(`PRETTIER_END ${target}\n`);
}

process.stderr.write('PRETTIER_DIAGNOSTIC_ONLY\n');
process.exit(1);
