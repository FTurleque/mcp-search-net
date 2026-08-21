import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const configureScript = resolve('packaging/windows/configure-install.ps1');

function runConfigure(
  installRoot: string,
  localAppData: string,
  userProfile: string,
  args: readonly string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      configureScript,
      '-InstallRoot',
      installRoot,
      '-FromInstaller',
      ...args,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        APPDATA: join(localAppData, 'Roaming'),
        USERPROFILE: userProfile,
        ...extraEnvironment,
      },
    },
  );
}

function windowsRuntimeTest(name: string, body: () => void) {
  it(name, () => {
    if (process.platform !== 'win32') return;
    body();
  });
}

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
    expect(configureInstaller).toContain('MCP_SEARCH_NET_TEST_FAIL_INTEGRATIONS_SAVE_ON_ATTEMPT');
    expect(configureInstaller.indexOf('Begin-ManagedIntegration')).toBeLessThan(
      configureInstaller.indexOf(
        'Write-JsonFile -Path $ConfigPath -Data $data -ExpectedSnapshot $snapshot',
      ),
    );
    expect(upgradeExercise).toContain('-FailIntegrationsSaveOnAttempt 2');
    expect(upgradeExercise).toContain("$preparedRecord.state -ne 'prepared'");
    expect(upgradeExercise).toContain("state -ne 'applied'");
    expect(upgradeExercise).toContain('est devenue fantôme après uninstall');
  });

  it('makes destructive cleanup depend on current ownership evidence, not prepared metadata alone', () => {
    expect(configureInstaller).toContain('function Test-JsonEntryOwnedByRecord');
    expect(configureInstaller).toContain('Get-ManagedRecordFingerprint');
    expect(configureInstaller).toContain("(Get-ManagedRecordState $Record) -eq 'prepared'");
    expect(configureInstaller).toContain('ne correspond plus au fingerprint géré — préservé');
    expect(configureInstaller).toContain('Test-NativeManagedServerOutput $get $BinLauncher');
    expect(configureInstaller).toContain('MCP_CONFIG_NATIVE_OWNERSHIP_CHECK_FAILED');
    expect(configureInstaller).toContain('function Test-CodexBlockOwnedByRecord');
    expect(configureInstaller).toContain('bloc MCP-SEARCH-NET modifié/non prouvé — préservé');
  });

  it('uses CAS reload-and-merge for every integration-ledger mutation', () => {
    expect(configureInstaller).toContain('function Invoke-IntegrationMutation');
    expect(configureInstaller).toContain('ConvertTo-IntegrationTable -Snapshot $snapshot');
    expect(configureInstaller).toContain(
      'Save-Integrations -Table $candidate -ExpectedSnapshot $snapshot',
    );
    expect(configureInstaller).toContain('Sync-IntegrationTable -Target $Table -Source $candidate');
    expect(configureInstaller).toContain(
      'MCP_CONFIG_INTEGRATIONS_CONCURRENT_MODIFICATION_RETRY_EXHAUSTED',
    );
    expect(configureInstaller).not.toContain(
      '$Table[$Key] = $Record\n    Save-Integrations $Table',
    );
    expect(configureInstaller).not.toContain('$Table.Remove($Key)\n    Save-Integrations $Table');
  });

  it('detects concurrent client file edits and retries from a fresh snapshot', () => {
    expect(configureInstaller).toContain('function Get-FileSnapshot');
    expect(configureInstaller).toContain('ExpectedSnapshot');
    expect(configureInstaller).toContain('Assert-FileSnapshotCurrent');
    expect(configureInstaller).toContain('MCP_CONFIG_CONCURRENT_MODIFICATION');
    expect(configureInstaller).toContain('MCP_SEARCH_NET_TEST_CONCURRENT_CONFIG_PUBLISH');
    expect(configureInstaller).toContain('$ClientConfigMaxRetries = 3');
    expect(configureInstaller).toContain('$bytes[0] -eq 0xEF');
    expect(configureInstaller).toContain('$bytes[1] -eq 0xBB');
    expect(configureInstaller).toContain('$bytes[2] -eq 0xBF');
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
    expect(installerBuilder).toContain('Get-QualifiedInnoRegistration');
    expect(installerBuilder).toContain("PSObject.Properties['DisplayVersion']");
    expect(installerBuilder).toContain("$ExpectedInnoVersion = '6.7.3'");
    expect(installerBuilder).toContain('INNO_SETUP_EXACT_VERSION_QUALIFIED');
    expect(installerBuilder).not.toContain('FileVersionInfo]::GetVersionInfo($Iscc)');
    expect(releasePublisher).toContain('IsccPath=$IsccPath');
    expect(releaseWorkflow).toContain("PSObject.Properties['DisplayVersion']");
    expect(releaseWorkflow).toContain('QUALIFIED_ISCC_PATH=$iscc');
    expect(releaseWorkflow).toContain('-IsccPath $env:QUALIFIED_ISCC_PATH');
    expect(upgradeWorkflow).toContain("PSObject.Properties['DisplayVersion']");
    expect(upgradeWorkflow).toContain('QUALIFIED_ISCC_PATH=$iscc');
    expect(upgradeWorkflow).toContain('-IsccPath $env:QUALIFIED_ISCC_PATH');
    expect(installerBuilder).not.toContain("'Inno Setup 7\\ISCC.exe'");
  });

  it('filters sparse uninstall registry records safely under StrictMode', () => {
    for (const source of [installerBuilder, releaseWorkflow, upgradeWorkflow]) {
      expect(source).toContain("PSObject.Properties['DisplayName']");
      expect(source).toContain("PSObject.Properties['DisplayVersion']");
      expect(source).toContain("PSObject.Properties['InstallLocation']");
      expect(source).not.toContain('$_.DisplayName -eq');
      expect(source).not.toContain('$_.DisplayVersion -eq');
    }
  });

  it('keeps a stable application identity across versions', () => {
    expect(installerBuilder).toContain("'{{A3F2C8D1-4B7E-4F9A-8C2D-1E6B0A3F7D5C}'");
    expect(innoTemplate).toContain('UsePreviousAppDir=yes');
  });

  windowsRuntimeTest(
    'preserves a user entry when only prepared ownership survived a pre-publish crash',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'mcp-ledger-prepared-uninstall-'));
      const installRoot = join(root, 'install');
      const localAppData = join(root, 'local');
      const userProfile = join(root, 'user');
      const clientPath = join(localAppData, 'github-copilot', 'intellij', 'mcp.json');
      const sidecarPath = join(installRoot, 'mcp-client-integrations.json');
      mkdirSync(dirname(clientPath), { recursive: true });
      mkdirSync(userProfile, { recursive: true });

      try {
        const crashed = runConfigure(
          installRoot,
          localAppData,
          userProfile,
          ['-Clients', 'copilot-jetbrains'],
          { MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH: 'mcp.json' },
        );
        expect(crashed.status).not.toBe(0);

        const prepared = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Record<
          string,
          { readonly ownership: string; readonly state: string }
        >;
        expect(prepared['copilot-jetbrains:mcp-search-net']).toMatchObject({
          ownership: 'managed',
          state: 'prepared',
        });

        const userConfig = `${JSON.stringify(
          {
            servers: {
              'mcp-search-net': {
                command: 'user-owned-command.exe',
                args: ['--user-owned'],
                env: { OWNER: 'user' },
              },
            },
            foreign: { preserve: true },
          },
          null,
          2,
        )}\r\n`;
        writeFileSync(clientPath, userConfig, 'utf8');
        const before = readFileSync(clientPath);

        const uninstall = runConfigure(installRoot, localAppData, userProfile, ['-Uninstall']);
        expect(uninstall.status).toBe(0);
        expect(readFileSync(clientPath).equals(before)).toBe(true);
        expect(existsSync(sidecarPath)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest('preserves an applied entry that the user changed after installation', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-ledger-applied-drift-'));
    const installRoot = join(root, 'install');
    const localAppData = join(root, 'local');
    const userProfile = join(root, 'user');
    const clientPath = join(localAppData, 'github-copilot', 'intellij', 'mcp.json');
    mkdirSync(dirname(clientPath), { recursive: true });
    mkdirSync(userProfile, { recursive: true });

    try {
      const installed = runConfigure(installRoot, localAppData, userProfile, [
        '-Clients',
        'copilot-jetbrains',
      ]);
      expect(installed.status).toBe(0);

      const userConfig = `${JSON.stringify(
        {
          servers: {
            'mcp-search-net': {
              command: 'replacement-owned-by-user.exe',
              args: ['--keep-me'],
            },
          },
        },
        null,
        2,
      )}\r\n`;
      writeFileSync(clientPath, userConfig, 'utf8');
      const before = readFileSync(clientPath);

      const uninstall = runConfigure(installRoot, localAppData, userProfile, ['-Uninstall']);
      expect(uninstall.status).toBe(0);
      expect(readFileSync(clientPath).equals(before)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  windowsRuntimeTest(
    'retries a concurrent ownership-sidecar writer and merges its distinct record',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'mcp-ledger-cas-'));
      const installRoot = join(root, 'install');
      const localAppData = join(root, 'local');
      const userProfile = join(root, 'user');
      mkdirSync(join(localAppData, 'github-copilot', 'intellij'), { recursive: true });
      mkdirSync(userProfile, { recursive: true });

      try {
        const concurrentLedger = JSON.stringify({
          'claude-desktop:mcp-search-net': {
            ownership: 'preexisting',
            state: 'observed',
            configPath: 'foreign-writer',
            configuredAt: '2026-08-18T00:00:00.000Z',
          },
        });
        const result = runConfigure(
          installRoot,
          localAppData,
          userProfile,
          ['-Clients', 'copilot-jetbrains'],
          {
            MCP_SEARCH_NET_TEST_CONCURRENT_CONFIG_PUBLISH: 'mcp-client-integrations.json',
            MCP_SEARCH_NET_TEST_CONCURRENT_CONFIG_CONTENT_BASE64: Buffer.from(
              concurrentLedger,
              'utf8',
            ).toString('base64'),
          },
        );
        expect(result.status).toBe(0);

        const ledger = JSON.parse(
          readFileSync(join(installRoot, 'mcp-client-integrations.json'), 'utf8'),
        ) as Record<string, { readonly ownership: string; readonly state: string }>;
        expect(ledger['claude-desktop:mcp-search-net']).toMatchObject({
          ownership: 'preexisting',
          state: 'observed',
        });
        expect(ledger['copilot-jetbrains:mcp-search-net']).toMatchObject({
          ownership: 'managed',
          state: 'applied',
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'does not leak a failed in-memory ownership mutation into a later successful commit',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'mcp-ledger-failed-candidate-'));
      const installRoot = join(root, 'install');
      const localAppData = join(root, 'local');
      const userProfile = join(root, 'user');
      const jetBrainsPath = join(localAppData, 'github-copilot', 'intellij', 'mcp.json');
      const claudeLogs = join(localAppData, 'Roaming', 'Claude', 'logs');
      mkdirSync(dirname(jetBrainsPath), { recursive: true });
      mkdirSync(claudeLogs, { recursive: true });
      mkdirSync(userProfile, { recursive: true });

      try {
        const result = runConfigure(
          installRoot,
          localAppData,
          userProfile,
          ['-Clients', 'copilot-jetbrains,claude-desktop'],
          { MCP_SEARCH_NET_TEST_FAIL_INTEGRATIONS_SAVE_ON_ATTEMPT: '1' },
        );
        expect(result.status).toBe(20);

        const ledger = JSON.parse(
          readFileSync(join(installRoot, 'mcp-client-integrations.json'), 'utf8'),
        ) as Record<string, { readonly ownership: string; readonly state: string }>;
        expect(ledger['copilot-jetbrains:mcp-search-net']).toBeUndefined();
        expect(ledger['claude-desktop:mcp-search-net']).toMatchObject({
          ownership: 'managed',
          state: 'applied',
        });
        expect(existsSync(jetBrainsPath)).toBe(false);
        expect(
          existsSync(join(localAppData, 'Roaming', 'Claude', 'claude_desktop_config.json')),
        ).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'configures the Codex client without a syntax error on a fresh profile',
    () => {
      // Regression: Get-CodexManagedBlock used `return if (...) { } else { }`,
      // which is not valid PowerShell syntax in any engine — it fails at runtime
      // with "the term 'if' is not recognized". Codex is included by default
      // ($AllClients), so every real installation hit this on first configure.
      const root = mkdtempSync(join(tmpdir(), 'mcp-codex-config-'));
      const installRoot = join(root, 'install');
      const localAppData = join(root, 'local');
      const userProfile = join(root, 'user');
      mkdirSync(userProfile, { recursive: true });

      try {
        const result = runConfigure(installRoot, localAppData, userProfile, ['-Clients', 'codex']);
        expect(result.stderr).not.toMatch(/is not recognized/);
        expect(result.status).toBe(0);

        const codexConfigPath = join(userProfile, '.codex', 'config.toml');
        expect(existsSync(codexConfigPath)).toBe(true);
        const codexConfig = readFileSync(codexConfigPath, 'utf8');
        expect(codexConfig).toContain('[mcp_servers.mcp-search-net]');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'reports an already-applied JSON client integration as up to date instead of rewriting it',
    () => {
      // A smoke/validation run against an install root that was already
      // configured must not silently rewrite an unchanged client entry on
      // every run, and must say so clearly rather than staying silent.
      const root = mkdtempSync(join(tmpdir(), 'mcp-already-integrated-json-'));
      const installRoot = join(root, 'install');
      const localAppData = join(root, 'local');
      const userProfile = join(root, 'user');
      mkdirSync(userProfile, { recursive: true });

      try {
        const first = runConfigure(installRoot, localAppData, userProfile, [
          '-Clients',
          'copilot-cli',
        ]);
        expect(first.status).toBe(0);
        const configPath = join(userProfile, '.copilot', 'mcp-config.json');
        const before = readFileSync(configPath, 'utf8');

        const second = runConfigure(installRoot, localAppData, userProfile, [
          '-Clients',
          'copilot-cli',
        ]);
        expect(second.status).toBe(0);
        expect(second.stdout).toContain('aucune modification');
        expect(readFileSync(configPath, 'utf8')).toBe(before);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'reports an already-applied Codex integration as up to date instead of rewriting it',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'mcp-already-integrated-codex-'));
      const installRoot = join(root, 'install');
      const localAppData = join(root, 'local');
      const userProfile = join(root, 'user');
      mkdirSync(userProfile, { recursive: true });

      try {
        const first = runConfigure(installRoot, localAppData, userProfile, ['-Clients', 'codex']);
        expect(first.status).toBe(0);
        const codexConfigPath = join(userProfile, '.codex', 'config.toml');
        const before = readFileSync(codexConfigPath, 'utf8');

        const second = runConfigure(installRoot, localAppData, userProfile, ['-Clients', 'codex']);
        expect(second.status).toBe(0);
        expect(second.stdout).toContain('aucune modification');
        expect(readFileSync(codexConfigPath, 'utf8')).toBe(before);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
