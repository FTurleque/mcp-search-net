import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog document preflight before persistent/network side effects', () => {
  it('rejects invalid document metadata before catalog DB creation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-invalid-document-'));
    roots.push(root);
    const dbPath = join(root, 'catalog.db');
    const sourcePath = join(root, 'catalog-sources.yml');
    writeFileSync(
      sourcePath,
      `schema_version: 1
sources:
  docs:
    display_name: Docs
    base_url: https://docs.example/
    documents:
      - stable_key: guide
        title: Guide
        url: https://docs.example/guide
        language: not_a_language
`,
      'utf8',
    );

    const result = await runCatalog(['sync', '--path', dbPath, '--file', sourcePath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CATALOG_DOCUMENT_LANGUAGE_INVALID');
    expect(existsSync(dbPath)).toBe(false);
  });
});

async function runCatalog(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', resolve('src/cli/catalog.ts'), ...args],
      {
        cwd: resolve('.'),
        windowsHide: true,
        timeout: 10_000,
        env: process.env,
      },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      readonly code?: unknown;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}
