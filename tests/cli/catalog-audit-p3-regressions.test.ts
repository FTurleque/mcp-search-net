import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('catalog CLI audit P3 regressions', () => {
  it.each([
    [
      'sync source aliases',
      ['sync', '--source-key', 'primary', '--source', 'secondary', '--file', 'missing.yml'],
      'Options --source-key and --source are mutually exclusive',
    ],
    [
      'purge source aliases',
      ['purge-versions', '--source-key', 'primary', '--source', 'secondary', '--dry-run'],
      'Options --source-key and --source are mutually exclusive',
    ],
    [
      'purge retention aliases',
      ['purge-versions', '--keep', '0', '--keep-previous', '3', '--dry-run'],
      'Options --keep and --keep-previous are mutually exclusive',
    ],
  ])('rejects conflicting %s', async (_label, arguments_, expectedMessage) => {
    await expectCatalogFailure(arguments_, expectedMessage);
  });

  it.each(['10001', '2147483648'])(
    'rejects an unsafe --rate-limit-ms value of %s before any sync I/O',
    async (value) => {
      await expectCatalogFailure(
        ['sync', '--rate-limit-ms', value, '--file', 'missing.yml'],
        `Invalid --rate-limit-ms ${value}`,
      );
    },
  );
});

async function expectCatalogFailure(
  arguments_: readonly string[],
  expectedMessage: string,
): Promise<void> {
  try {
    await execFileAsync(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli/catalog.ts'), ...arguments_],
      { cwd: resolve('.'), windowsHide: true },
    );
    throw new Error('Expected catalog CLI to fail');
  } catch (error) {
    expect(error).toMatchObject({ code: 1 });
    expect((error as { readonly stderr?: string }).stderr).toContain(expectedMessage);
  }
}
