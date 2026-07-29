import { execFile } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog operational CLI', () => {
  it('reports health, creates a verified backup and supports documented file restore', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-operations-'));
    roots.push(root);
    const catalogPath = join(root, 'catalog.db');
    const snapshotPath = join(root, 'backups', 'catalog.snapshot.db');

    await runCatalog('init', '--path', catalogPath);
    const healthy = JSON.parse(await runCatalog('health', '--path', catalogPath)) as {
      readonly status: string;
      readonly verification: { readonly status: string };
    };
    expect(healthy).toMatchObject({ status: 'healthy', verification: { status: 'OK' } });

    const backup = JSON.parse(
      await runCatalog('backup', '--path', catalogPath, '--output', snapshotPath),
    ) as { readonly status: string; readonly sha256: string };
    expect(backup.status).toBe('backed_up');
    expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/u);

    writeFileSync(catalogPath, 'not-a-sqlite-database');
    await expect(runCatalog('health', '--path', catalogPath)).rejects.toMatchObject({ code: 1 });

    copyFileSync(snapshotPath, catalogPath);
    const restored = JSON.parse(await runCatalog('health', '--path', catalogPath)) as {
      readonly status: string;
    };
    expect(restored.status).toBe('healthy');
  });
});

async function runCatalog(...arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', resolve('src/cli/catalog.ts'), ...arguments_],
    { cwd: resolve('.'), windowsHide: true },
  );
  return result.stdout;
}
