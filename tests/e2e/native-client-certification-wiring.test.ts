import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const configurePath = resolve('packaging/windows/configure-install.ps1');
const validatorPath = resolve('scripts/validate-native-client-certification-wiring.ps1');
const workflowPath = resolve('.github/workflows/native-client-certification-smoke.yml');

const configure = readFileSync(configurePath, 'utf8');
const validator = readFileSync(validatorPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

describe('native client certification wiring', () => {
  it('counts semantic managed-environment reuse instead of duplicated helper calls', () => {
    const directUses = configure.match(/env\s*=\s*\(New-ManagedClientEnv\)/g)?.length ?? 0;
    const sharedUses = configure.match(/env\s*=\s*\$managedEnv\b/g)?.length ?? 0;

    expect(configure).toMatch(/\$managedEnv\s*=\s*New-ManagedClientEnv\b/);
    expect(directUses).toBeGreaterThanOrEqual(1);
    expect(sharedUses).toBeGreaterThanOrEqual(4);
    expect(directUses + sharedUses).toBeGreaterThanOrEqual(5);

    expect(validator).toContain('$managedEnvDirectUses');
    expect(validator).toContain('$managedEnvSharedUses');
    expect(validator).toContain(
      '$managedEnvUses = $managedEnvDirectUses + $managedEnvSharedUses',
    );
    expect(validator).not.toContain(
      "[regex]::Matches($configure, 'env\\s+=\\s+\\(New-ManagedClientEnv\\)').Count",
    );
  });

  it('reuses the same PowerShell 5.1 validator in the master promotion smoke workflow', () => {
    expect(workflow).toContain('scripts/validate-native-client-certification-wiring.ps1');
    expect(workflow).toContain('run: .\\scripts\\validate-native-client-certification-wiring.ps1');
    expect(workflow).not.toContain(
      'Expected at least five confined stdio env uses for supported integrations, got $managedEnvUses.',
    );
  });

  it('tracks the current Codex block confinement contract', () => {
    expect(configure).toContain('function New-CodexMcpBlock');
    expect(configure).toContain("$homeLine = 'MCP_SEARCH_HOME =");
    expect(configure).toContain("$configLine = 'MCP_CONFIG_PATH =");
    expect(configure).toContain("$catalogLine = 'MCP_CATALOG_PATH =");
    expect(configure).toContain("'[mcp_servers.mcp-search-net.env]'");

    expect(validator).toContain('$codexConfinementPatterns');
    expect(validator).toContain('\\$homeLine');
    expect(validator).toContain('\\$configLine');
    expect(validator).toContain('\\$catalogLine');
    expect(validator).not.toContain('$configEnvLine');
    expect(validator).not.toContain('$catalogEnvLine');
  });

  it('executes the validator on Windows and keeps an equivalent static contract elsewhere', () => {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', validatorPath],
        { encoding: 'utf8', windowsHide: true },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('NATIVE_CLIENT_CERTIFICATION_PARSE_VALID');
      expect(result.stdout).toMatch(/sharedUses=\d+/);
      return;
    }

    expect(validator).toContain('Set-StrictMode -Version Latest');
    expect(validator).toContain("'MCP_SEARCH_HOME', 'MCP_CONFIG_PATH', 'MCP_CATALOG_PATH'");
    expect(validator).toContain("'mcp', 'get', 'mcp-search-net', '--json'");
    expect(validator).toContain('Test-NativeServerOutput');
    expect(validator).toContain('New-CodexMcpBlock');
  });
});
