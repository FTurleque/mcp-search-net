import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Windows in-place upgrade contract', () => {
  const updater = readFileSync('packaging/windows/update-installation.ps1', 'utf8');
  const portableInstaller = readFileSync('packaging/windows/install.ps1', 'utf8');
  const innoTemplate = readFileSync(
    'packaging/windows/mcp-search-net-installer.iss.template',
    'utf8',
  );
  const distributionBuilder = readFileSync(
    'scripts/release/build-windows-distribution.ps1',
    'utf8',
  );
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
    expect(innoTemplate).toContain('ArchiveExtraction=full');
    expect(innoTemplate).toContain('UninstallLogMode=overwrite');
    expect(installerBuilder).toContain('@@PAYLOAD_ZIP@@');
    expect(installerBuilder).toContain('@@DISTRIBUTION_NAME@@');
  });

  it('rejects destructive use of an unowned or dangerous installation root', () => {
    expect(updater).toContain(
      "$OwnershipMarkerPath = Join-Path $InstallRoot '.mcp-search-net-installation.json'",
    );
    expect(updater).toContain('MCP_UPDATE_UNSAFE_INSTALL_ROOT');
    expect(updater).toContain('Test-LegacyOwnedInstallation');
    expect(updater).toContain('Test-RecoverableTransactionOwnership');
    expect(updater).toContain('Assert-SafeInstallRoot');
    expect(updater).toContain('Ensure-OwnershipMarker');
    expect(updater).toContain('[string]$manifest.name -ne $ManagedApplicationName');
  });

  it('publishes a crash-durable checksummed transaction record before activation', () => {
    expect(updater).toContain('[System.IO.FileOptions]::WriteThrough');
    expect(updater).toContain('$stream.Flush($true)');
    expect(updater).toContain('MoveFileEx');
    expect(updater).toContain('$MoveFileWriteThrough = 0x8');
    expect(updater).toContain("schemaVersion = '1.1'");
    expect(updater).toContain('checksumSha256');
    expect(updater).toContain("Write-TransactionManifest -Phase 'activating'");
    expect(updater.indexOf("Write-TransactionManifest -Phase 'activating'")).toBeLessThan(
      updater.indexOf('$activationCount = 0'),
    );
  });

  it('stages and rolls back all installer-managed program surfaces', () => {
    expect(updater).toContain("$StageRoot = Join-Path $InstallRoot '.install-staging'");
    expect(updater).toContain("$RollbackRoot = Join-Path $InstallRoot '.install-rollback'");
    expect(updater).toContain("$TransactionPath = Join-Path $RollbackRoot 'transaction.json'");
    expect(updater).toContain("Write-TransactionManifest -Phase 'committed'");
    expect(updater).toContain('Restore-Transaction');
    expect(updater).toContain('MCP_UPDATE_ROLLBACK_FAILED');
    expect(updater).toContain('TestCrashActivationAfterEntries');
    for (const directory of ['app', 'bin', 'runtime', 'scripts', 'docker']) {
      expect(updater).toContain(`'${directory}'`);
    }
  });

  it('treats cleanup failure after the durable commit as cleanup-pending, not activation failure', () => {
    expect(updater).toContain('Invoke-PostCommitCleanup');
    expect(updater).toContain('MCP_UPDATE_CLEANUP_PENDING');
    expect(updater).toContain(
      "$cleanupState = if ($cleanupFailureCount -eq 0) { 'complete' } else { 'pending' }",
    );
    expect(updater.indexOf("Write-TransactionManifest -Phase 'committed'")).toBeLessThan(
      updater.indexOf('$cleanupFailureCount = Invoke-PostCommitCleanup'),
    );
  });

  it('passes uninstall cleanup targets as data instead of interpolating them into PowerShell source', () => {
    expect(innoTemplate).toContain("Script := 'param([string]$TargetPath)");
    expect(innoTemplate).toContain(`-TargetPath "' + Path + '"`);
    expect(innoTemplate).not.toContain("Remove-Item -LiteralPath ''' + Path + '''");
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
    expect(updater).toContain('if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf))');
    expect(updater).toContain("($template.target + '.default')");
    expect(updater).not.toContain("Join-Path $InstallRoot 'data' | Remove-Item");
    expect(updater).not.toContain("Join-Path $InstallRoot '.env' | Remove-Item");
    expect(innoTemplate).toContain(
      "DeleteFile(ExpandConstant('{app}\\.mcp-search-net-installation.json'));",
    );
  });

  it('keeps a stable application identity across versions', () => {
    expect(installerBuilder).toContain("'{{A3F2C8D1-4B7E-4F9A-8C2D-1E6B0A3F7D5C}'");
    expect(innoTemplate).toContain('UsePreviousAppDir=yes');
  });
});
