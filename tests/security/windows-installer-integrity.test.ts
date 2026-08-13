import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Windows installer runtime integrity', () => {
  const installer = readFileSync('scripts/install-user.ps1', 'utf8');
  const uninstaller = readFileSync('scripts/uninstall-user.ps1', 'utf8');
  const verifier = readFileSync('scripts/windows/verify-file-sha256.ps1', 'utf8');
  const launcher = readFileSync('scripts/windows/mcp-search-net.cmd', 'utf8');
  const catalogLauncher = readFileSync('scripts/windows/mcp-search-net-catalog.cmd', 'utf8');
  const maintenanceLauncher = readFileSync('scripts/windows/mcp-search-net-maintain.cmd', 'utf8');
  const servicesLauncher = readFileSync('scripts/windows/mcp-search-net-services.cmd', 'utf8');
  const containerLauncher = readFileSync('scripts/windows/mcp-search-net-container.cmd', 'utf8');
  const installedProbe = readFileSync('scripts/probe-installed-mcp.mjs', 'utf8');
  const installationRecipe = readFileSync('scripts/test-installation.ps1', 'utf8');
  const configureInstall = readFileSync('packaging/windows/configure-install.ps1', 'utf8');
  const releasePublisher = readFileSync('scripts/release/publish-windows-release.ps1', 'utf8');
  const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');
  const dockerIgnore = readFileSync('.dockerignore', 'utf8');
  const compose = readFileSync('compose.yaml', 'utf8');

  it('pins the official Node archive hash and verifies before extracting', () => {
    expect(installer).toContain('0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821');
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

  it('preserves preexisting MCP JSON entries and removes only installer-owned entries', () => {
    expect(configureInstall).toContain("throw \"Configuration JSON invalide '$Path'");
    expect(configureInstall).toContain('$alreadyManaged = $integrations.ContainsKey($integKey)');
    expect(configureInstall).toContain(
      'if ((Get-PropertyExists $root $ServerKey) -and -not $alreadyManaged)',
    );
    expect(configureInstall).toContain("ownership    = 'preexisting'");
    expect(configureInstall).toContain("if ($rec.ownership -ne 'managed')");
    expect(configureInstall).toContain('entrée non suivie par cet installateur — préservée');
    expect(configureInstall).toContain('$legacyOwned = $false');
    expect(configureInstall).toContain('ancienne entrée mcpServers non gérée — préservée');
    expect(configureInstall).not.toContain('$existed = Get-PropertyExists $root $ServerKey');
  });

  it('rejects release version drift and verifies the pinned Windows installer toolchain', () => {
    expect(releasePublisher).toContain('$Package.version -ne $Version');
    expect(releasePublisher).toContain('$PackageLock.version -ne $Version');
    expect(releasePublisher).toContain("$PackageLock.packages[''].version -ne $Version");
    expect(releasePublisher).toContain('$PackagedPackage.version -ne $Version');
    expect(releaseWorkflow).toContain("$innoVersion = '6.7.3'");
    expect(releaseWorkflow).toContain(
      "$innoUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe'",
    );
    expect(releaseWorkflow).toContain(
      "$innoSha256 = '9C73C3BAE7ED48D44112A0F48E66742C00090BDB5BEF71D9D3C056C66E97B732'",
    );
    const innoVerification = releaseWorkflow.indexOf('.\\scripts\\windows\\verify-file-sha256.ps1');
    const innoExecution = releaseWorkflow.indexOf('Start-Process', innoVerification + 1);
    expect(innoVerification).toBeGreaterThan(0);
    expect(innoExecution).toBeGreaterThan(innoVerification);
    expect(releaseWorkflow).not.toContain('choco install innosetup');
  });

  it('keeps installed Docker builds away from local data and preserves operator configuration', () => {
    expect(installer).toContain("Join-Path $RepositoryRoot '.dockerignore'");
    expect(installer).toContain(
      "Copy-UserConfig (Join-Path $RepositoryRoot 'config\\application.docker.yml')",
    );
    expect(dockerIgnore).toMatch(/^data$/mu);
    expect(dockerIgnore).toMatch(/^runtime$/mu);
    expect(dockerIgnore).toMatch(/^config\/\*$/mu);
    expect(dockerIgnore).toMatch(/^!config\/application\.docker\.yml$/mu);
    expect(dockerIgnore).toMatch(/^!config\/official-sources\.yml$/mu);
  });

  it('records whether the source revision is clean instead of presenting dirty builds as exact', () => {
    expect(installer).toContain('status --porcelain --untracked-files=normal');
    expect(installer).toContain(
      '$SourceState = if ([string]::IsNullOrWhiteSpace($WorkingTreeStatus))',
    );
    expect(installer).toContain('sourceState = $SourceState');
    expect(installer).toContain("$env:GITHUB_SHA -match '^[a-fA-F0-9]{40}$'");
  });

  it('anchors local launchers in the installed root and bounds the installed MCP probe', () => {
    for (const localLauncher of [launcher, catalogLauncher, maintenanceLauncher]) {
      expect(localLauncher).toContain('pushd "%MCP_SEARCH_HOME%"');
      expect(localLauncher).toContain('popd');
      expect(localLauncher).toContain('MCP_EXIT_CODE');
    }
    expect(installedProbe).toContain('INSTALLED_LAUNCHER_PATH_INVALID');
    expect(installedProbe).toContain('requestTimeoutMs = 30_000');
    expect(installedProbe).toContain("join('bin', 'mcp-search-net.cmd')");
    expect(installedProbe).toContain('command: resolvedLauncher');
  });

  it('generates Copilot-compatible local MCP examples', () => {
    expect(installer).toContain('mcpServers = [ordered]@{');
    expect(installer).not.toMatch(/^\s*servers = \[ordered\]@\{/mu);
    expect(installer).toContain("type = 'local'");
    expect(installer).toContain("tools = @('*')");
    expect(installationRecipe).toContain("$McpExample.mcpServers.'mcp-search-net'");
  });

  it('keeps the STDIO container opt-in and protects Compose teardown with ShouldProcess', () => {
    expect(compose).toMatch(/mcp-search-net:\s+profiles:\s+- stdio/gu);
    expect(containerLauncher).toContain('--profile stdio run');
    expect(uninstaller).toContain(
      'if ($PSCmdlet.ShouldProcess("projet Compose $project", $ComposeAction))',
    );
    expect(uninstaller.indexOf('$PSCmdlet.ShouldProcess("projet Compose $project"')).toBeLessThan(
      uninstaller.indexOf('& $Docker.Source @DownArguments'),
    );
    expect(servicesLauncher).toContain('where docker >nul 2>&1');
    expect(servicesLauncher).toContain('compose.hybrid.yaml');
    expect(containerLauncher).toContain('where docker >nul 2>&1');
    expect(installationRecipe).not.toMatch(/[‘’]/u);
  });

  it('loads the generated Crawl4AI token through the real Windows launcher', () => {
    if (process.platform !== 'win32') {
      expect(launcher).toContain('for /f "tokens=1,* delims=="');
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'mcp-launcher-token-'));
    const installRoot = join(root, 'Installed Root With Spaces');
    const nodePath = join(installRoot, 'runtime', 'node-v24.18.0-win-x64', 'node.exe');
    const serverPath = join(installRoot, 'app', 'build', 'bootstrap', 'main.js');
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    try {
      mkdirSync(dirname(nodePath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      copyFileSync(process.execPath, nodePath);
      writeFileSync(
        serverPath,
        'process.stdout.write(JSON.stringify({ token: process.env.MCP_CRAWL4AI_TOKEN ?? "missing", catalogPath: process.env.MCP_CATALOG_PATH, cwd: process.cwd() }));',
      );
      writeFileSync(
        join(installRoot, '.env'),
        `CRAWL4AI_API_TOKEN=${token}\nSEARXNG_SECRET=test\n`,
      );
      const environment: NodeJS.ProcessEnv = { ...process.env, MCP_SEARCH_HOME: installRoot };
      delete environment['MCP_CRAWL4AI_TOKEN'];

      const output = execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', resolve('scripts/windows/mcp-search-net.cmd')],
        { encoding: 'utf8', env: environment, windowsHide: true },
      );
      const result = JSON.parse(output) as {
        readonly token: string;
        readonly catalogPath: string;
        readonly cwd: string;
      };
      expect(result.token).toBe(token);
      expect(result.catalogPath.toLowerCase()).toBe(
        join(installRoot, 'data', 'catalog.db').toLowerCase(),
      );
      expect(resolve(result.cwd).toLowerCase()).toBe(resolve(installRoot).toLowerCase());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
