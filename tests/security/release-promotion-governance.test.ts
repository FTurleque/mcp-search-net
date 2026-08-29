import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const contractScript = resolve('scripts/check-release-pr-contract.mjs');
const tempRoots: string[] = [];
const validBody = `<!-- release-qualification-source: github-checks-current-head -->

## Qualification du candidat courant

Source de vérité unique : checks GitHub du HEAD courant.
- Windows installation and STDIO packaging
- Native client certification smoke
- Catalog backup durability
- Windows in-place upgrade

## Règle de merge

aucune autorisation explicite de merge n'a été donnée.
Le merge n'est autorisé qu'après vérification du HEAD exact de la PR.
`;

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('release promotion governance', () => {
  it('accepts a direct develop to master pull request', () => {
    // 'develop' is the original, historically-working promotion source (PRs #83/#115/#130
    // all merged this way). The release/promote-develop-* marker-commit branch tested below
    // is an additional, stricter path for whoever wants the extra topology guarantees --
    // never a replacement that locks out the direct-develop flow.
    const result = runContract(process.cwd(), {
      RELEASE_PR_BODY: validBody,
      RELEASE_PR_HEAD_SHA: 'a'.repeat(40),
      RELEASE_PR_HEAD_REF: 'develop',
      RELEASE_PR_BASE_REF: 'master',
      RELEASE_PR_VERIFY_TOPOLOGY: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('RELEASE_PR_CONTRACT_VALID');
  });

  it('rejects an arbitrary branch that is neither develop nor a release promotion branch', () => {
    const result = runContract(process.cwd(), {
      RELEASE_PR_BODY: validBody,
      RELEASE_PR_HEAD_SHA: 'a'.repeat(40),
      RELEASE_PR_HEAD_REF: 'feature/unrelated-branch',
      RELEASE_PR_BASE_REF: 'master',
      RELEASE_PR_VERIFY_TOPOLOGY: '0',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RELEASE_PR_SOURCE_BRANCH_INVALID');
  });

  it('accepts one empty promotion marker directly on the current synced develop head', () => {
    const fixture = createPromotionFixture();
    const result = runContract(fixture.root, {
      RELEASE_PR_BODY: validBody,
      RELEASE_PR_HEAD_SHA: fixture.promotionSha,
      RELEASE_PR_HEAD_REF: 'release/promote-develop-20260823-180000',
      RELEASE_PR_BASE_REF: 'master',
      RELEASE_PR_VERIFY_TOPOLOGY: '1',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('RELEASE_PR_CONTRACT_VALID');
    expect(result.stdout).toContain(`"developSha":"${fixture.developSha}"`);
    expect(result.stdout).toContain(`"masterSha":"${fixture.masterSha}"`);
    expect(result.stdout).toContain('"promotionMarkerCommits":1');
  });

  it('rejects a promotion candidate that changes content above develop', () => {
    const fixture = createPromotionFixture();
    writeFileSync(join(fixture.root, 'candidate-only.txt'), 'forbidden\n', 'utf8');
    git(fixture.root, ['add', 'candidate-only.txt']);
    git(fixture.root, ['commit', '-m', 'forbidden candidate content']);
    const changedHead = git(fixture.root, ['rev-parse', 'HEAD']);

    const result = runContract(fixture.root, {
      RELEASE_PR_BODY: validBody,
      RELEASE_PR_HEAD_SHA: changedHead,
      RELEASE_PR_HEAD_REF: 'release/promote-develop-20260823-180000',
      RELEASE_PR_BASE_REF: 'master',
      RELEASE_PR_VERIFY_TOPOLOGY: '1',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /RELEASE_PR_HEAD_NOT_DIRECTLY_ON_CURRENT_DEVELOP|RELEASE_PR_HEAD_TREE_DIFFERS_FROM_DEVELOP/u,
    );
  });

  it('rejects promotion while current master is not an ancestor of develop', () => {
    const fixture = createPromotionFixture();

    git(fixture.root, ['checkout', '--detach', fixture.masterSha]);
    writeFileSync(join(fixture.root, 'master-hotfix.txt'), 'hotfix\n', 'utf8');
    git(fixture.root, ['add', 'master-hotfix.txt']);
    git(fixture.root, ['commit', '-m', 'master-only hotfix']);
    const newerMaster = git(fixture.root, ['rev-parse', 'HEAD']);
    git(fixture.root, ['update-ref', 'refs/remotes/origin/master', newerMaster]);
    git(fixture.root, ['checkout', '--detach', fixture.promotionSha]);

    const result = runContract(fixture.root, {
      RELEASE_PR_BODY: validBody,
      RELEASE_PR_HEAD_SHA: fixture.promotionSha,
      RELEASE_PR_HEAD_REF: 'release/promote-develop-20260823-180000',
      RELEASE_PR_BASE_REF: 'master',
      RELEASE_PR_VERIFY_TOPOLOGY: '1',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RELEASE_PR_MASTER_NOT_SYNCED_INTO_DEVELOP');
  });
});

function createPromotionFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-release-promotion-'));
  tempRoots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.name', 'mcp-search-net tests']);
  git(root, ['config', 'user.email', 'tests@example.invalid']);

  writeFileSync(join(root, 'app.txt'), 'master\n', 'utf8');
  git(root, ['add', 'app.txt']);
  git(root, ['commit', '-m', 'master baseline']);
  const masterSha = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-b', 'develop']);
  writeFileSync(join(root, 'app.txt'), 'develop\n', 'utf8');
  git(root, ['commit', '-am', 'develop candidate']);
  const developSha = git(root, ['rev-parse', 'HEAD']);

  git(root, ['update-ref', 'refs/remotes/origin/master', masterSha]);
  git(root, ['update-ref', 'refs/remotes/origin/develop', developSha]);
  git(root, ['checkout', '-b', 'release/promote-develop-20260823-180000']);
  git(root, ['commit', '--allow-empty', '-m', 'release: qualify develop promotion']);
  const promotionSha = git(root, ['rev-parse', 'HEAD']);

  return { root, masterSha, developSha, promotionSha };
}

function runContract(cwd: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [contractScript], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

function git(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}
