import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Windows in-place upgrade contract', () => {
  const updater = readFileSync('packaging/windows/update-installation.ps1', 'utf8');
  const portableInstaller = readFileSync('packaging/windows/install.ps1', 'utf8');
  const innoTemplate = readFileSync('packaging/windows/mcp-search-net-installer.iss.template', 'utf8');
  const distributionBuilder = readFileSync('scripts/release/build-windows-distribution.ps1', 'utf8');
  const installerBuilder = readFileSync('scripts/release/build-windows-installer.ps1', 'utf8');

  it('uses one packaged updater for ZIP and setup installations', () => {
    expect(portableInstaller).toContain("'scripts\\update-installation.ps1'");
    expect(portableInstaller).toContain('-PackageRoot $PackageRoot -InstallRoot $InstallRoot');
    expect(distributionBuilder).toContain("'packaging\\windows\\update-installation.ps1'");
    expect(installerBuilder).toContain("'scripts\\update-installation.ps1'");
  });

  it('does not let Inno overwrite the installation tree directly', () => {
    expect(innoTemplate).not.toContain('Source: "{#SourceDir}\\*"; DestDir: "{app}"');
    expect(innoTemplate).toContain('mcp-search-net-payload.zip');
    expect(innoTemplate).toContain('function PrepareToInstall(var NeedsRestart: Boolean): String;');
    expect(innoTemplate).toContain('RunPayloadUpdate()');
    expect(installerBuilder).toContain('@@PAYLOAD_ZIP@@');
    expect(installerBuilder).toContain('@@DISTRIBUTION_NAME@@');
  });

  it('stages and rolls back all installer-managed program surfaces', () => {
    expect(updater).toContain("$StageRoot = Join-Path $InstallRoot '.install-staging'");
    expect(updater).toContain("$RollbackRoot = Join-Path $InstallRoot '.install-rollback'");
    expect(updater).toContain("$TransactionPath = Join-Path $RollbackRoot 'transaction.json'");
    expect(updater).toContain("Write-TransactionManifest -Phase 'activating'");
    expect(updater).toContain("Write-TransactionManifest -Phase 'committed'");
    expect(updater).toContain('Restore-Transaction');
    expect(updater).toContain('MCP_UPDATE_ROLLBACK_FAILED');
    for (const directory of ['app', 'bin', 'runtime', 'scripts', 'docker']) {
      expect(updater).toContain(`'${directory}'`);
    }
  });

  it('preserves user state while refreshing versioned defaults', () => {
    for (const persistentPath of [
      'config\\application.yml',
      'config\\application.docker.yml',
      'config\\official-sources.yml',
      'config\\searxng\\settings.yml',
    ]) {
      expect(updater).toContain(persistentPath);
    }
    expect(updater).toContain("if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf))");
    expect(updater).toContain("($template.target + '.default')");
    expect(updater).not.toContain("Join-Path $InstallRoot 'data' | Remove-Item");
    expect(updater).not.toContain("Join-Path $InstallRoot '.env' | Remove-Item");
  });

  it('keeps a stable application identity across versions', () => {
    expect(installerBuilder).toContain("'{{A3F2C8D1-4B7E-4F9A-8C2D-1E6B0A3F7D5C}'");
    expect(innoTemplate).toContain('UsePreviousAppDir=yes');
  });
});
