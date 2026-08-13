import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function runMaintain(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli/catalog-maintain.ts'), ...args],
      { cwd: resolve('.'), windowsHide: true, timeout: 10_000, env: process.env },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

async function runRerankedSearch(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli/catalog-reranked-search.ts'), ...args],
      { cwd: resolve('.'), windowsHide: true, timeout: 10_000, env: process.env },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('catalog-maintain CLI entrypoint', () => {
  it('shows usage for --help', async () => {
    const { exitCode, stderr } = await runMaintain(['--help']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Usage/i);
  });

  it('exits with code 1 for unknown option', async () => {
    const { exitCode, stderr } = await runMaintain(['--unknown']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Unknown option/i);
  });

  it('runs maintenance on a freshly initialized catalog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-maintain-subprocess-'));
    try {
      const dbPath = join(root, 'catalog.db');
      const { exitCode: initCode } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', resolve('src/cli/catalog.ts'), 'init', '--path', dbPath],
        { cwd: resolve('.'), windowsHide: true, timeout: 10_000, env: process.env },
      ).then(
        ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
        (err: unknown) => ({
          exitCode: (err as { code?: number }).code ?? 1,
          stdout: '',
          stderr: '',
        }),
      );
      expect(initCode).toBe(0);

      const { exitCode, stdout } = await runMaintain(['--path', dbPath]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/keepSyncRuns|maxSyncRunAgeDays|vacuum/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('catalog-reranked-search CLI entrypoint', () => {
  it('shows usage for --help', async () => {
    const { exitCode, stderr } = await runRerankedSearch(['--help']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Usage/i);
  });

  it('exits with code 1 when --query is missing', async () => {
    const { exitCode, stderr } = await runRerankedSearch([]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--query|Missing required/i);
  });

  it('exits with code 1 for unknown option', async () => {
    const { exitCode, stderr } = await runRerankedSearch(['--query', 'test', '--unknown']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Unknown option/i);
  });

  it('runs reranked search on an initialized catalog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-reranked-subprocess-'));
    try {
      const dbPath = join(root, 'catalog.db');
      await execFileAsync(
        process.execPath,
        ['--import', 'tsx', resolve('src/cli/catalog.ts'), 'init', '--path', dbPath],
        { cwd: resolve('.'), windowsHide: true, timeout: 10_000, env: process.env },
      ).catch(() => undefined);

      const { exitCode, stdout } = await runRerankedSearch([
        '--query',
        'typescript',
        '--path',
        dbPath,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/results|sections/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
