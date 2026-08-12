import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('catalog sync dry-run contract', () => {
  it.each([
    ['--config', 'config/application.yml'],
    ['--limit', '1'],
    ['--rate-limit-ms', '10'],
    ['--resume-after', 'docs:guide'],
  ])('rejects unsupported option %s instead of silently ignoring it', async (option, value) => {
    try {
      await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('src/cli/catalog.ts'),
          'sync',
          '--dry-run',
          '--file',
          'missing.yml',
          option,
          value,
        ],
        { cwd: resolve('.'), windowsHide: true },
      );
      throw new Error('Expected catalog CLI to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect((error as { readonly stderr?: string }).stderr).toContain(
        `${option} is not supported with catalog sync --dry-run`,
      );
    }
  });
});
