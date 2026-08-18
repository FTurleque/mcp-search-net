import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Windows in-place upgrade contract', () => {
  const updater = readFileSync('packaging/windows/update-installation.ps1', 'utf8');
  const configureInstaller = readFileSync('packaging/windows/configure-install.ps1', 'utf8');
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
  const releasePublisher = readFileSync('scripts/release/publish-windows-release.ps1', 'utf8');
  const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');
  const upgradeWorkflow = readFileSync('.github/workflows/windows-in-place-upgrade.yml', 'utf8');
  const upgradeExercise = readFileSync('scripts/test-packaged-upgrade.ps1', 'utf8');

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

  it('rejects managed reparse points before any upgrade mutation can escape InstallRoot', () => {
    expect(updater).toContain('MCP_UPDATE_REPARSE_POINT');
    expect(updater).toContain('Assert-NoReparsePointInExistingPathChain');
    expect(updater).toContain('Assert-ManagedMutationPathsSafe');
    expect(updater.indexOf('Assert-ManagedMutationPathsSafe')).toBeLessThan(
      updater.indexOf('Ensure-OwnershipMarker'),
    );
    expect(upgradeExercise).toContain('New-Item -ItemType Junction');
    expect(upgradeExercise).toContain('MCP_UPDATE_REPARSE_POINT');
    expect(upgradeExercise).toContain('must-survive');
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

  it('publishes client configuration files atomically and recovers abandoned crash staging', () => {
    expect(configureInstaller).toContain('[System.IO.FileOptions]::WriteThrough');
    expect(configureInstaller).toContain('$stream.Flush($true)');
    expect(configureInstaller).toContain('ConfigFileOps]::MoveFileEx');
    expect(configureInstaller).toContain('Write-DurableUtf8File -Path $EnvFile');
    expect(configureInstaller).toContain('Write-DurableUtf8File -Path $CodexConfigPath');
    expect(configureInstaller).toContain('MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH');
    expect(configureInstaller).toContain('Remove-AbandonedPublicationTemps');
    expect(configureInstaller).toContain('MCP_CONFIG_STALE_TEMP_CLEANUP_FAILED');
    expect(upgradeExercise).toContain("-CrashBeforePublish 'mcp.json.example'");
    expect(upgradeExercise).toContain('La reprise n a pas nettoyé le staging orphelin');
  });

  it('precommits managed ownership and reconciles a failed applied commit on retry', () => {
    expect(configureInstaller).toContain('function Begin-ManagedIntegration');
    expect(configureInstaller).toContain("state = 'prepared'");
    expect(configureInstaller).toContain('function Complete-ManagedIntegration');
    expect(configureInstaller).toContain("state = 'applied'");
    expect(configureInstaller).toContain(
      'MCP_SEARCH_NET_TEST_FAIL_INTEGRATIONS_SAVE_ON_ATTEMPT',
    );
    expect(configureInstaller.indexOf('Begin-ManagedIntegration')).toBeLessThan(
      configureInstaller.indexOf('Write-JsonFile -Path $ConfigPath -Data $data -ExpectedSnapshot $snapshot'),
    );
    expect(upgradeExercise).toContain('-FailIntegrationsSaveOnAttempt 2');
    expect(upgradeExercise).toContain("$preparedRecord.state -ne 'prepared'");
    expect(upgradeExercise).toContain("state -ne 'applied'");
    expect(upgradeExercise).toContain('est devenue fantôme après uninstall');
  });

  it('detects concurrent client file edits and retries from a fresh snapshot', () => {
    expect(configureInstaller).toContain('function Get-FileSnapshot');
    expect(configureInstaller).toContain('ExpectedSnapshot');
    expect(configureInstaller).toContain('Assert-FileSnapshotCurrent');
    expect(configureInstaller).toContain('MCP_CONFIG_CONCURRENT_MODIFICATION');
    expect(configureInstaller).toContain('MCP_SEARCH_NET_TEST_CONCURRENT_CONFIG_PUBLISH');
    expect(configureInstaller).toContain('$ClientConfigMaxRetries = 3');
    expect(upgradeExercise).toContain("-ConcurrentPublishTarget 'mcp.json'");
    expect(upgradeExercise).toContain('Une modification concurrente étrangère a été perdue.');
    expect(upgradeExercise).toContain('foreignObject.preserve');
  });

  it('returns a material partial-failure status instead of masking client configuration failures', () => {
    expect(configureInstaller).toContain('Record-MaterialFailure');
    expect(configureInstaller).toContain('MCP_CONFIG_PARTIAL_FAILURE');
    expect(configureInstaller).toContain('exit 20');
    expect(configureInstaller).toContain("Record-MaterialFailure 'Intégrations metadata'");
    expect(upgradeExercise).toContain('Code de partial failure inattendu');
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

  it('keeps .env and configuration backups during conservative uninstall', () => {
    expect(configureInstaller).not.toContain(
      "foreach ($artifact in @('.env', 'mcp-client-integrations.json'",
    );
    expect(configureInstaller).not.toContain('Remove-Item -LiteralPath $BackupRoot -Recurse');
    expect(configureInstaller).toContain(
      'Les données utilisateur, .env et .config-backups sont conservés.',
    );
    expect(upgradeExercise).toContain("'.env n a pas été conservé byte-identical.'");
    expect(innoTemplate).toContain('Silent uninstall therefore preserves them.');
  });

  it('gates every production Windows installer on the transactional upgrade qualification', () => {
    expect(installerBuilder).toContain('if (-not $Smoke)');
    expect(installerBuilder).toContain('tests/security/windows-upgrade-contract.test.ts');
    expect(installerBuilder).toContain("'scripts\\test-packaged-upgrade.ps1'");
    expect(installerBuilder).toContain('WINDOWS_PRODUCTION_INSTALLER_TRANSACTION_GATES_VALID');
  });

  it('binds release compilation to the exact verified Inno Setup 6.7.3 binary', () => {
    expect(installerBuilder).toContain('[string] $IsccPath');
    expect(installerBuilder).toContain(
      'Un setup de production exige -IsccPath vers le binaire Inno Setup $ExpectedInnoVersion déjà vérifié.',
    );
    expect(installerBuilder).toContain('FileVersionInfo]::GetVersionInfo($Iscc)');
    expect(installerBuilder).toContain("$ExpectedInnoVersion = '6.7.3'");
    expect(installerBuilder).toContain('INNO_SETUP_EXACT_VERSION_QUALIFIED');
    expect(releasePublisher).toContain('IsccPath=$IsccPath');
    expect(releaseWorkflow).toContain('QUALIFIED_ISCC_PATH=$iscc');
    expect(releaseWorkflow).toContain('-IsccPath $env:QUALIFIED_ISCC_PATH');
    expect(upgradeWorkflow).toContain('QUALIFIED_ISCC_PATH=$iscc');
    expect(upgradeWorkflow).toContain('-IsccPath $env:QUALIFIED_ISCC_PATH');
    expect(installerBuilder).not.toContain("'Inno Setup 7\\ISCC.exe'");
  });

  it('keeps a stable application identity across versions', () => {
    expect(installerBuilder).toContain("'{{A3F2C8D1-4B7E-4F9A-8C2D-1E6B0A3F7D5C}'");
    expect(innoTemplate).toContain('UsePreviousAppDir=yes');
  });
});
