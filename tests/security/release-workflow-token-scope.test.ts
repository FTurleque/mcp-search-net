import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');

describe('Windows release workflow token scope', () => {
  it('does not persist checkout credentials or expose GH_TOKEN to the full job', () => {
    expect(releaseWorkflow).toContain('persist-credentials: false');

    const jobEnvironmentStart = releaseWorkflow.indexOf('    env:\n');
    const stepsStart = releaseWorkflow.indexOf('    steps:\n');
    expect(jobEnvironmentStart).toBeGreaterThanOrEqual(0);
    expect(stepsStart).toBeGreaterThan(jobEnvironmentStart);
    expect(releaseWorkflow.slice(jobEnvironmentStart, stepsStart)).not.toContain('GH_TOKEN');
  });

  it('provides GH_TOKEN only to the two steps that call authenticated gh commands', () => {
    const tokenAssignments = releaseWorkflow.match(/GH_TOKEN:\s*\$\{\{ github\.token \}\}/gu) ?? [];
    expect(tokenAssignments).toHaveLength(2);

    expect(releaseWorkflow).toMatch(
      /- name: Vérifier la CI exact-head avant publication[\s\S]*?env:\s*\n\s*GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?gh api/u,
    );
    expect(releaseWorkflow).toMatch(
      /- name: Construire, qualifier et publier la GitHub Release \(master\)[\s\S]*?env:\s*\n\s*GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?publish-windows-release\.ps1/u,
    );
  });
});
