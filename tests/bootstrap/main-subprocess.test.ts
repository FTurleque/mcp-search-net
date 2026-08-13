import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function runMain(env: NodeJS.ProcessEnv = {}): Promise<{
  exitCode: number;
  stderr: string;
}> {
  try {
    await execFileAsync(process.execPath, ['--import', 'tsx', resolve('src/bootstrap/main.ts')], {
      cwd: resolve('.'),
      windowsHide: true,
      timeout: 8_000,
      env: { ...process.env, ...env },
    });
    return { exitCode: 0, stderr: '' };
  } catch (error) {
    const err = error as { code?: number; stderr?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stderr: err.stderr ?? '',
    };
  }
}

describe('bootstrap main entrypoint', () => {
  it('exits with code 1 and logs configuration_invalid when config file is missing', async () => {
    const { exitCode, stderr } = await runMain({
      MCP_CONFIG_PATH: '/nonexistent/config.yml',
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/configuration_invalid|Cannot read|ENOENT/i);
  });

  it('exits with code 1 when config YAML is not a valid application config', async () => {
    const { exitCode, stderr } = await runMain({
      MCP_CONFIG_PATH: resolve('package.json'),
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/configuration_invalid|Invalid configuration|Invalid YAML/i);
  });
});
