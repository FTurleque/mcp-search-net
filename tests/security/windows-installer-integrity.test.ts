import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Windows installer runtime integrity', () => {
  const installer = readFileSync('scripts/install-user.ps1', 'utf8');
  const verifier = readFileSync('scripts/windows/verify-file-sha256.ps1', 'utf8');
  const launcher = readFileSync('scripts/windows/mcp-search-net.cmd', 'utf8');

  it('pins the official Node archive hash and verifies before extracting', () => {
    expect(installer).toContain('f2aa33b35b75aca5f3f7b85675a6f6423201053e9381911e64961f3bda2528ab');
    expect(installer.indexOf('verify-file-sha256.ps1')).toBeGreaterThan(0);
    expect(installer.indexOf('verify-file-sha256.ps1')).toBeLessThan(
      installer.indexOf('Expand-Archive'),
    );
    expect(verifier).toContain('Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256');
    expect(verifier).toContain('RUNTIME_ARCHIVE_CHECKSUM_MISMATCH');
  });

  it('verifies Authenticode before executing Node and writes a proof manifest', () => {
    const signatureCheck = installer.indexOf('Get-AuthenticodeSignature -LiteralPath $NodeExe');
    const nodeExecution = installer.indexOf("& $NodeExe '--version'");
    expect(signatureCheck).toBeGreaterThan(0);
    expect(nodeExecution).toBeGreaterThan(0);
    expect(signatureCheck).toBeLessThan(nodeExecution);
    expect(installer).toContain(
      '$NodeSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid',
    );
    expect(installer).toContain('OpenJS Foundation');
    expect(installer).toContain('node-runtime-proof.json');
    expect(installer).toContain('nodeExeSha256');
  });

  it('preserves staged upgrades, restores the previous app on activation failure and reports locks', () => {
    expect(installer).toContain("$StageRoot = Join-Path $InstallRoot '.install-staging'");
    expect(installer).toContain('Move-Item -LiteralPath $AppRoot -Destination $PreviousAppRoot');
    expect(installer).toContain('Move-Item -LiteralPath $PreviousAppRoot -Destination $AppRoot');
    expect(installer).toContain('Rollback effectué');
    expect(installer).toContain('$TestFailActivation');
    expect(installer).toContain('MCP_INSTALL_TEST_ACTIVATION_FAILURE');
    expect(installer).toContain('Get-CimInstance Win32_Process');
    expect(installer).toContain('Get-CurrentProcessLineage');
    expect(installer).toContain('Write-McpSearchNetProcessReport');
    expect(installer).toContain('$ForceStopExistingProcess');
  });

  it('generates per-installation provider secrets and removes launcher defaults', () => {
    expect(installer).toContain('RandomNumberGenerator]::Create()');
    expect(installer).toContain("$EnvironmentPath = Join-Path $InstallRoot '.env'");
    expect(installer).toContain('CRAWL4AI_API_TOKEN=$Crawl4aiLocalToken');
    expect(installer).toContain('SEARXNG_SECRET=$SearxngLocalSecret');
    expect(launcher).toContain('findstr /b /l "CRAWL4AI_API_TOKEN="');
    expect(launcher).not.toContain('mcp-search-local-development-token');
  });

  it('loads the generated Crawl4AI token through the real Windows launcher', () => {
    if (process.platform !== 'win32') {
      expect(launcher).toContain('for /f "tokens=1,* delims=="');
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'mcp-launcher-token-'));
    const nodePath = join(root, 'runtime', 'node-v24.17.0-win-x64', 'node.exe');
    const serverPath = join(root, 'app', 'build', 'bootstrap', 'main.js');
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    try {
      mkdirSync(dirname(nodePath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      copyFileSync(process.execPath, nodePath);
      writeFileSync(
        serverPath,
        'process.stdout.write(process.env.MCP_CRAWL4AI_TOKEN ?? "missing");',
      );
      writeFileSync(join(root, '.env'), `CRAWL4AI_API_TOKEN=${token}\nSEARXNG_SECRET=test\n`);
      const environment: NodeJS.ProcessEnv = { ...process.env, MCP_SEARCH_HOME: root };
      delete environment['MCP_CRAWL4AI_TOKEN'];

      const output = execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', resolve('scripts/windows/mcp-search-net.cmd')],
        { encoding: 'utf8', env: environment, windowsHide: true },
      );
      expect(output).toBe(token);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
