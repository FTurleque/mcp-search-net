import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const installerTemplate = readFileSync(
  'packaging/windows/mcp-search-net-installer.iss.template',
  'utf8',
);
const configureInstall = readFileSync('packaging/windows/configure-install.ps1', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');

describe('audit Windows and release remediation', () => {
  it('preserves user-generated data unless uninstall explicitly opted into deletion', () => {
    expect(installerTemplate).toContain(
      "if DeleteUserDataOnUninstall and DirExists(ExpandConstant('{app}')) then",
    );
    expect(installerTemplate).toContain('Silent uninstall therefore preserves them.');
    expect(installerTemplate).not.toContain(
      "if DirExists(ExpandConstant('{localappdata}\\mcp-search-net')) then",
    );
    expect(installerTemplate).not.toMatch(
      /if DirExists\(ExpandConstant\('\{app\}'\)\) then\s*DelTree\(ExpandConstant\('\{app\}'\)/u,
    );
  });

  it('refuses a master release without successful required CI jobs on the exact SHA', () => {
    expect(releaseWorkflow).toContain('actions: read');
    expect(releaseWorkflow).toContain('head_sha=$env:GITHUB_SHA');
    expect(releaseWorkflow).toContain('CI_EXACT_HEAD_QUALIFIED');
    expect(releaseWorkflow).toContain('Node.js 24 validation');
    expect(releaseWorkflow).toContain('Docker integration and live E2E');
    expect(releaseWorkflow).toContain('Windows installation and STDIO packaging');
    expect(releaseWorkflow).toContain("$innoVersion = '6.7.1'");
    expect(releaseWorkflow).toContain(
      "$innoSha256 = '4D11E8050B6185E0D49BD9E8CC661A7A59F44959A621D31D11033124C4E8A7B0'",
    );
    expect(releaseWorkflow).toContain('.\\scripts\\windows\\verify-file-sha256.ps1');
    expect(releaseWorkflow).not.toContain('choco install innosetup');

    const exactHeadGate = releaseWorkflow.indexOf('CI_EXACT_HEAD_QUALIFIED');
    const qualificationStep = releaseWorkflow.indexOf(
      'Construire et qualifier les artefacts Windows',
    );
    const publishJob = releaseWorkflow.indexOf('\n  publish:\n');
    expect(exactHeadGate).toBeGreaterThanOrEqual(0);
    expect(qualificationStep).toBeGreaterThan(exactHeadGate);
    expect(publishJob).toBeGreaterThan(qualificationStep);
    expect(releaseWorkflow.slice(publishJob)).toContain('needs: qualify');
  });

  it('keeps preexisting JSON client entries ownership-aware', () => {
    expect(configureInstall).toContain("ownership    = 'preexisting'");
    expect(configureInstall).toContain("if ($rec.ownership -ne 'managed')");
  });

  it('preserves an unmarked preexisting Codex TOML server table', () => {
    expect(configureInstall).toContain('function Test-CodexMcpEntry');
    expect(configureInstall).toContain("'[mcp_servers.mcp-search-net]'");
    expect(configureInstall).toContain('elseif (Test-CodexMcpEntry $text)');
    expect(configureInstall).toContain("ownership    = 'preexisting'");
    expect(configureInstall).toContain(
      "Codex Desktop : table 'mcp_servers.mcp-search-net' existante non gérée — préservée.",
    );
    expect(configureInstall).toContain(
      'Codex Desktop : entrée préexistante/non gérée — préservée.',
    );
  });
});
