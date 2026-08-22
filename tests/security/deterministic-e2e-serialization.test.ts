import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
}

describe('deterministic E2E scheduling contract', () => {
  it('serializes the heavy Windows child-process E2E files without weakening their assertions', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve('package.json'), 'utf8'),
    ) as PackageManifest;
    const command = packageJson.scripts?.['test:e2e:deterministic'];

    expect(command).toBeDefined();
    expect(command).toContain('--no-file-parallelism');
    expect(command).toContain('tests/e2e/mcp-stdio.test.ts');
    expect(command).toContain('tests/e2e/native-client-certification-wiring.test.ts');
    expect(command).not.toContain('--test-timeout');
    expect(command).not.toContain('--testTimeout');
  });
});
