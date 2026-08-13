import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');

describe('Windows release workflow token scope', () => {
  it('scopes read permissions to the qualification job and keeps checkout credentials non-persistent', () => {
    const jobsStart = releaseWorkflow.indexOf('\njobs:\n');
    const workflowLevel = releaseWorkflow.slice(0, jobsStart);
    const qualifyStart = releaseWorkflow.indexOf('\n  qualify:\n');
    const publishStart = releaseWorkflow.indexOf('\n  publish:\n');
    const qualifyJob = releaseWorkflow.slice(qualifyStart, publishStart);

    expect(workflowLevel).not.toContain('\npermissions:\n');
    expect(qualifyJob).toContain('permissions:\n      contents: read\n      actions: read');
    expect(releaseWorkflow).toContain('persist-credentials: false');
    expect(releaseWorkflow.match(/contents:\s*write/gu) ?? []).toHaveLength(1);
  });

  it('isolates write permission in a publish-only job without repository code execution', () => {
    const publishStart = releaseWorkflow.indexOf('\n  publish:\n');
    expect(publishStart).toBeGreaterThanOrEqual(0);
    const publishJob = releaseWorkflow.slice(publishStart);

    expect(publishJob).toContain('permissions:\n      contents: write\n      actions: read');
    expect(publishJob).not.toContain('actions/checkout@');
    expect(publishJob).not.toContain('publish-windows-release.ps1');
    expect(publishJob).toContain('gh run download');
    expect(publishJob).toContain("'release', 'create', $tag");
    expect(publishJob).toContain('& gh @releaseArgs');
  });

  it('qualifies artifacts before publication and scopes GH_TOKEN to authenticated gh steps', () => {
    const publishStart = releaseWorkflow.indexOf('\n  publish:\n');
    const qualifyJob = releaseWorkflow.slice(0, publishStart);
    const publishJob = releaseWorkflow.slice(publishStart);
    const tokenAssignments = releaseWorkflow.match(/GH_TOKEN:\s*\$\{\{ github\.token \}\}/gu) ?? [];

    expect(qualifyJob).toContain('publish-windows-release.ps1');
    expect(qualifyJob).toContain('-ValidateOnly');
    expect(tokenAssignments).toHaveLength(2);
    expect(releaseWorkflow).toMatch(
      /- name: Vérifier la CI exact-head avant publication[\s\S]*?env:\s*\n\s*GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?gh api/u,
    );
    expect(publishJob).toMatch(
      /- name: Publier uniquement les artefacts déjà qualifiés[\s\S]*?env:\s*\n\s*GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?gh run download/u,
    );
    expect(publishJob).toContain("'release', 'create', $tag");
    expect(publishJob).toContain('& gh @releaseArgs');
  });
});
