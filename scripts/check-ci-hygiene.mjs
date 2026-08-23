import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const forbiddenWorkflows = [
  '.github/workflows/one-shot-node-diagnostics.yml',
  '.github/workflows/one-shot-node-fix.yml',
  '.github/workflows/one-shot-remediation-cleanup.yml',
  '.github/workflows/one-shot-post-audit-doc-reconcile.yml',
  '.github/workflows/temp-post-audit-remediation.yml',
  '.github/workflows/temp-pdfjs-security-update.yml',
];

const remaining = forbiddenWorkflows.filter((path) => existsSync(resolve(root, path)));
if (remaining.length > 0) {
  throw new Error(`OBSOLETE_PRIVILEGED_WORKFLOWS_PRESENT:${remaining.join(',')}`);
}

const ciWorkflow = readText('.github/workflows/ci.yml');
const releasePrWorkflow = readText('.github/workflows/release-pr-contract.yml');
const releasePrContract = readText('scripts/check-release-pr-contract.mjs');

assert(
  !ciWorkflow.includes('release/promote-develop-'),
  'PROMOTION_BRANCH_MUST_NOT_TRIGGER_PUSH_CI',
);
assert(
  !releasePrWorkflow.includes("if: github.event.pull_request.head.ref == 'develop'"),
  'DIRECT_DEVELOP_PROMOTION_FILTER_FORBIDDEN',
);
for (const required of [
  "RELEASE_PR_VERIFY_TOPOLOGY: '1'",
  'fetch-depth: 0',
  '+refs/heads/develop:refs/remotes/origin/develop',
  '+refs/heads/master:refs/remotes/origin/master',
]) {
  assert(releasePrWorkflow.includes(required), `RELEASE_PR_WORKFLOW_GUARD_MISSING:${required}`);
}
for (const required of [
  'PROMOTION_BRANCH_PATTERN',
  'RELEASE_PR_SOURCE_BRANCH_INVALID',
  'RELEASE_PR_HEAD_NOT_DIRECTLY_ON_CURRENT_DEVELOP',
  'RELEASE_PR_HEAD_TREE_DIFFERS_FROM_DEVELOP',
  'RELEASE_PR_MASTER_NOT_SYNCED_INTO_DEVELOP',
  'RELEASE_PR_PROMOTION_MARKER_COMMIT_COUNT_INVALID',
  'RELEASE_PR_PROMOTION_MARKER_MUST_NOT_CHANGE_CONTENT',
  "'merge-base', '--is-ancestor', 'origin/master', 'origin/develop'",
  "'diff', '--quiet', 'origin/develop', 'HEAD', '--'",
]) {
  assert(releasePrContract.includes(required), `RELEASE_PR_CONTRACT_GUARD_MISSING:${required}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'CI_HYGIENE_CHECK_PASSED',
      forbiddenWorkflowsAbsent: forbiddenWorkflows.length,
      isolatedPromotionCandidate: true,
      promotionTopologyEnforced: true,
    },
    null,
    2,
  )}\n`,
);

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
