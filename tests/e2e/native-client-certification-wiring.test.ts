import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const configurePath = resolve('packaging/windows/configure-install.ps1');
const validatorPath = resolve('scripts/validate-native-client-certification-wiring.ps1');
const collectorPath = resolve('scripts/certify-native-clients.ps1');
const workflowPath = resolve('.github/workflows/native-client-certification-smoke.yml');

const configure = readFileSync(configurePath, 'utf8');
const validator = readFileSync(validatorPath, 'utf8');
const collector = readFileSync(collectorPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

const directEnvPattern = /env\s*=\s*\(New-ManagedClientEnv\)/g;
const sharedEnvPattern = /env\s*=\s*\$managedEnv\b/g;
const managedEnvInitPattern = /\$managedEnv\s*=\s*New-ManagedClientEnv\b/;
const codexHomePattern = /\$homeLine\s*=\s*'MCP_SEARCH_HOME =/;
const codexConfigPattern = /\$configLine\s*=\s*'MCP_CONFIG_PATH =/;
const codexCatalogPattern = /\$catalogLine\s*=\s*'MCP_CATALOG_PATH =/;

const powershellArgs = [
  '-NoLogo',
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  validatorPath,
];

const expectedCertificationClients = ['Claude Code', 'Claude Desktop', 'Codex'];
const expectedExcludedClients = ['IntelliJ IDEA + GitHub Copilot', 'GitHub Copilot CLI'];

describe('native client certification wiring', () => {
  it('counts semantic managed-environment reuse instead of duplicated helper calls', () => {
    const directUses = configure.match(directEnvPattern)?.length ?? 0;
    const sharedUses = configure.match(sharedEnvPattern)?.length ?? 0;

    expect(configure).toMatch(managedEnvInitPattern);
    expect(directUses).toBeGreaterThanOrEqual(1);
    expect(sharedUses).toBeGreaterThanOrEqual(4);
    expect(directUses + sharedUses).toBeGreaterThanOrEqual(5);
    expect(validator).toContain('$managedEnvDirectUses');
    expect(validator).toContain('$managedEnvSharedUses');
    expect(validator).toContain('$managedEnvUses = $managedEnvDirectUses + $managedEnvSharedUses');
  });

  it('reuses the same validator in the master promotion smoke workflow', () => {
    expect(workflow).toContain('scripts/validate-native-client-certification-wiring.ps1');
    expect(workflow).toContain('run: .\\scripts\\validate-native-client-certification-wiring.ps1');
  });

  it('tracks the current Codex block confinement contract', () => {
    expect(configure).toContain('function New-CodexMcpBlock');
    expect(configure).toMatch(codexHomePattern);
    expect(configure).toMatch(codexConfigPattern);
    expect(configure).toMatch(codexCatalogPattern);
    expect(configure).toContain("'[mcp_servers.mcp-search-net.env]'");
    expect(validator).toContain('$codexConfinementPatterns');
    expect(validator).not.toContain('$configEnvLine');
    expect(validator).not.toContain('$catalogEnvLine');
  });

  it('executes the validator on Windows and keeps a static contract elsewhere', () => {
    if (process.platform === 'win32') {
      const result = spawnSync('powershell.exe', powershellArgs, {
        encoding: 'utf8',
        windowsHide: true,
      });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('NATIVE_CLIENT_CERTIFICATION_PARSE_VALID');
      return;
    }

    expect(validator).toContain('Set-StrictMode -Version Latest');
    expect(validator).toContain('MCP_SEARCH_HOME');
    expect(validator).toContain('MCP_CONFIG_PATH');
    expect(validator).toContain('MCP_CATALOG_PATH');
    expect(validator).toContain('Test-NativeServerOutput');
    expect(validator).toContain('New-CodexMcpBlock');
  });

  it('executes the smoke summary contract on Windows and keeps the master workflow aligned', () => {
    expect(workflow).toContain(
      '$raw = @(.\\scripts\\certify-native-clients.ps1 -SmokeMode -OutputDirectory $output)',
    );
    expect(workflow).toContain("if ($report.mode -ne 'smoke')");
    expect(workflow).toContain('if ($null -ne $report.reportPath)');
    expect(workflow).not.toContain("Join-Path $output 'native-client-certification.json'");

    if (process.platform !== 'win32') {
      expect(collector).toContain("mode = 'smoke'");
      expect(collector).toContain('certificationScope = $CertificationClients');
      expect(collector).toContain('excludedClients = $ExcludedCertificationClients');
      expect(collector).toContain('reportPath = $null');
      return;
    }

    const outputDirectory = mkdtempSync(join(tmpdir(), 'mcp-native-smoke-'));
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          collectorPath,
          '-SmokeMode',
          '-OutputDirectory',
          outputDirectory,
        ],
        { encoding: 'utf8', windowsHide: true },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const report = JSON.parse(result.stdout) as {
        schemaVersion: string;
        mode: string;
        certificationScope: string[];
        excludedClients: string[];
        reportPath: string | null;
      };

      expect(report.schemaVersion).toBe('1.0');
      expect(report.mode).toBe('smoke');
      expect(report.certificationScope).toEqual(expectedCertificationClients);
      expect(report.excludedClients).toEqual(expectedExcludedClients);
      expect(report.reportPath).toBeNull();
      expect(readdirSync(outputDirectory)).toEqual([]);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
