import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('subprocess entrypoint coverage contract', () => {
  it('keeps every V8-excluded process entrypoint covered by a real subprocess or STDIO test', () => {
    const coverageConfig = read('vitest.config.ts');
    const stdio = read('tests/e2e/mcp-stdio.test.ts');
    const catalog = read('tests/cli/catalog-subprocess.test.ts');
    const maintenance = read('tests/cli/catalog-maintain-subprocess.test.ts');

    for (const entrypoint of [
      'src/bootstrap/main.ts',
      'src/cli/catalog.ts',
      'src/cli/catalog-maintain.ts',
      'src/cli/catalog-reranked-search.ts',
    ]) {
      expect(coverageConfig).toContain(`'${entrypoint}'`);
    }
    expect(stdio).toContain('build/bootstrap/main.js');
    expect(catalog).toContain("resolve('src/cli/catalog.ts')");
    expect(maintenance).toContain("resolve('src/cli/catalog-maintain.ts')");
    expect(maintenance).toContain("resolve('src/cli/catalog-reranked-search.ts')");
  });
});
