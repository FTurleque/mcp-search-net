import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const forbiddenWorkflows = [
  '.github/workflows/one-shot-node-diagnostics.yml',
  '.github/workflows/one-shot-node-fix.yml',
  '.github/workflows/one-shot-remediation-cleanup.yml',
  '.github/workflows/one-shot-post-audit-doc-reconcile.yml',
  '.github/workflows/temp-post-audit-remediation.yml',
];

const remaining = forbiddenWorkflows.filter((path) => existsSync(resolve(root, path)));
if (remaining.length > 0) {
  throw new Error(`OBSOLETE_PRIVILEGED_WORKFLOWS_PRESENT:${remaining.join(',')}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'CI_HYGIENE_CHECK_PASSED',
      forbiddenWorkflowsAbsent: forbiddenWorkflows.length,
    },
    null,
    2,
  )}\n`,
);
