import { readFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';

const paths = [
  'src/cli/catalog-source-config.ts',
  'src/infrastructure/fetch/pdf-text-extractor.ts',
  'tests/cli/catalog-source-normalization.test.ts',
];

for (const path of paths) {
  const source = await readFile(path, 'utf8');
  const config = (await resolveConfig(path)) ?? {};
  const formatted = await format(source, { ...config, filepath: path });
  process.stdout.write(`---BEGIN:${path}---\n${formatted}---END:${path}---\n`);
}

process.exitCode = 1;
