import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function runCatalog(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli/catalog.ts'), ...args],
      {
        cwd: resolve('.'),
        windowsHide: true,
        timeout: 10_000,
        env: { ...process.env, ...env },
      },
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

describe('catalog CLI entrypoint', () => {
  it('exits with code 1 and shows usage when no arguments are provided', async () => {
    const { exitCode, stderr } = await runCatalog([]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Usage|catalog/i);
  });

  it('exits with code 1 and shows usage for --help', async () => {
    const { exitCode, stderr } = await runCatalog(['--help']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Usage/i);
  });

  it('exits with code 1 for an unknown command', async () => {
    const { exitCode, stderr } = await runCatalog(['unknown-command']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Unknown command|Usage/i);
  });

  it('init creates a catalog database at the specified path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-subprocess-'));
    try {
      const dbPath = join(root, 'test.db');
      const { exitCode } = await runCatalog(['init', '--path', dbPath]);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('status reports catalog statistics at the specified path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-subprocess-'));
    try {
      const dbPath = join(root, 'test.db');
      await runCatalog(['init', '--path', dbPath]);
      const { exitCode, stdout } = await runCatalog(['status', '--path', dbPath]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/sourceCount|documentCount|status/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('search returns results from an initialized catalog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-subprocess-'));
    try {
      const dbPath = join(root, 'test.db');
      await runCatalog(['init', '--path', dbPath]);
      const { exitCode } = await runCatalog(['search', '--query', 'typescript', '--path', dbPath]);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
