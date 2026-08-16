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

describe('catalog sync preflight guards', () => {
  it('rejects duplicate stable keys before catalog DB creation', async () => {
    const fixture = createFixture();
    const sourcePath = join(fixture.root, 'catalog-sources.yml');
    writeFileSync(
      sourcePath,
      `schema_version: 1
sources:
  docs:
    display_name: Docs
    base_url: https://docs.example/
    documents:
      - stable_key: guide
        title: Guide A
        url: https://docs.example/a
      - stable_key: guide
        title: Guide B
        url: https://docs.example/b
`,
      'utf8',
    );

    const result = await runCatalog([
      'sync',
      '--path',
      fixture.dbPath,
      '--file',
      sourcePath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('catalog source docs contains duplicate stable_key guide');
    expect(existsSync(fixture.dbPath)).toBe(false);
  });

  it('rejects a resume cursor without fingerprint before catalog open', async () => {
    const fixture = createFixture();
    const sourcePath = join(fixture.root, 'catalog-sources.yml');
    writeFileSync(sourcePath, validSourceConfig(), 'utf8');

    const result = await runCatalog([
      'sync',
      '--path',
      fixture.dbPath,
      '--file',
      sourcePath,
      '--source-key',
      'docs',
      '--resume-after',
      'guide',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '--resume-after requires --resume-fingerprint from the previous sync output',
    );
    expect(existsSync(fixture.dbPath)).toBe(false);
  });

  it('rejects a resume fingerprint without a cursor before opening the catalog', async () => {
    const fixture = createFixture();
    const sourcePath = join(fixture.root, 'catalog-sources.yml');
    writeFileSync(sourcePath, validSourceConfig(), 'utf8');

    const result = await runCatalog([
      'sync',
      '--path',
      fixture.dbPath,
      '--file',
      sourcePath,
      '--resume-fingerprint',
      'a'.repeat(64),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--resume-fingerprint requires --resume-after');
    expect(existsSync(fixture.dbPath)).toBe(false);
  });
});

function createFixture(): { readonly root: string; readonly dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-sync-guards-'));
  roots.push(root);
  return { root, dbPath: join(root, 'catalog.db') };
}

function validSourceConfig(): string {
  return `schema_version: 1
sources:
  docs:
    display_name: Docs
    base_url: https://docs.example/
    documents:
      - stable_key: guide
        title: Guide
        url: https://docs.example/guide
`;
}

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
