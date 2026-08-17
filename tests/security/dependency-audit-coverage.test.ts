import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/dependency-audit.yml';
const dependencyAuditWorkflow = readFileSync(workflowPath, 'utf8');

describe('scheduled dependency audit coverage', () => {
  it('audits both the release and integration branches on every scheduled run', () => {
    const expectedRefs = ['        ref:', '          - master', '          - develop'].join('\n');

    expect(dependencyAuditWorkflow).toContain('fail-fast: false');
    expect(dependencyAuditWorkflow).toContain(expectedRefs);
    expect(dependencyAuditWorkflow).toContain('ref: ${{ matrix.ref }}');
  });

  it('keeps checkout credentials read-only and audits full plus production dependency trees', () => {
    expect(dependencyAuditWorkflow).toContain('permissions:\n  contents: read');
    expect(dependencyAuditWorkflow).toContain('persist-credentials: false');
    expect(dependencyAuditWorkflow).toContain('run: npm ci');
    expect(dependencyAuditWorkflow).toContain('run: npm audit --audit-level=moderate');
    expect(dependencyAuditWorkflow).toContain(
      'run: npm audit --omit=dev --audit-level=moderate',
    );
  });
});
