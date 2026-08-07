import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const installerTemplate = readFileSync('packaging/windows/mcp-search-net-installer.iss.template', 'utf8');
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
    expect(releaseWorkflow).toContain('--require-checksums');
    expect(releaseWorkflow.indexOf('CI_EXACT_HEAD_QUALIFIED')).toBeLessThan(
      releaseWorkflow.indexOf('Construire, qualifier et publier la GitHub Release'),
    );
  });

  it('keeps preexisting JSON client entries ownership-aware', () => {
    expect(configureInstall).toContain("ownership    = 'preexisting'");
    expect(configureInstall).toContain("if ($rec.ownership -ne 'managed')");
  });
});
