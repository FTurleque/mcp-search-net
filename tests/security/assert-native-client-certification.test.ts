import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve('scripts/release/assert-native-client-certification.ps1');
const REPOSITORY = 'FTurleque/mcp-search-net';
const COMMIT_SHA = 'd'.repeat(40);
const OTHER_SHA = 'e'.repeat(40);
const RUN_ID = '1000';

interface WorkflowRun {
  id: string;
  head_sha: string;
  head_branch: string;
  event: string;
  conclusion: string;
  created_at: string;
}

interface ArtifactEntry {
  name: string;
  id: number;
  expired: boolean;
}

interface Fixture {
  runs: WorkflowRun[];
  artifactsByRunId: Record<string, ArtifactEntry[]>;
  artifactContentByRunId: Record<string, unknown>;
}

function validClientEvidence(client: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    client,
    clientVersion: '2.1.240',
    os: 'Windows 10 Pro',
    serverVersion: '1.1.4',
    sourceRevision: COMMIT_SHA,
    sourceState: 'CLEAN',
    nodeVersion: '24.18.0',
    searchRequestId: `${client}-search`,
    readRequestId: `${client}-read`,
    searchSectionId: 8,
    readSectionId: 8,
    sectionFound: true,
    truncated: false,
    characterCount: 1234,
    nativeToolInvocationObserved: true,
    observedAt: '2026-08-22T12:00:00.000Z',
    verdict: 'PASS_NATIVE',
    ...overrides,
  };
}

function validArtifact(overrides: Record<string, unknown> = {}, clients?: unknown[]) {
  return {
    schemaVersion: '1.0',
    sourceRevision: COMMIT_SHA,
    repository: REPOSITORY,
    recordedBy: 'test-actor',
    recordedAt: '2026-08-22T12:05:00.000Z',
    collectorReportSha256: 'a'.repeat(64),
    clients: clients ?? [
      validClientEvidence('Claude Code'),
      validClientEvidence('Claude Desktop'),
      validClientEvidence('Codex'),
    ],
    verdict: 'PASS_NATIVE_3_OF_3',
    ...overrides,
  };
}

function successfulRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: RUN_ID,
    head_sha: COMMIT_SHA,
    head_branch: 'master',
    event: 'workflow_dispatch',
    conclusion: 'success',
    created_at: '2026-08-22T12:00:00.000Z',
    ...overrides,
  };
}

const FAKE_GH_SOURCE = `#!/usr/bin/env node
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const fixture = JSON.parse(readFileSync(process.env.FAKE_GH_FIXTURE, 'utf8'));
const args = process.argv.slice(2);

function extractRunId(target) {
  const match = /actions\\/runs\\/(\\w+)\\/artifacts/.exec(target);
  return match ? match[1] : undefined;
}

if (args[0] === 'api') {
  const target = args[1] || '';
  if (target.includes('/actions/workflows/') && target.includes('/runs')) {
    process.stdout.write(JSON.stringify({ workflow_runs: fixture.runs || [] }));
    process.exit(0);
  }
  const runId = extractRunId(target);
  if (runId !== undefined) {
    const artifacts = (fixture.artifactsByRunId || {})[runId] || [];
    process.stdout.write(JSON.stringify({ artifacts }));
    process.exit(0);
  }
  process.stderr.write('fake gh: unhandled api target ' + target + '\\n');
  process.exit(1);
}

if (args[0] === 'run' && args[1] === 'download') {
  const runId = args[2];
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
  const behavior = (fixture.artifactContentByRunId || {})[runId];
  if (behavior === undefined) {
    process.stderr.write('fake gh: no content configured for run ' + runId + '\\n');
    process.exit(1);
  }
  if (behavior === 'DOWNLOAD_FAILS') {
    process.stderr.write('fake gh: simulated download failure\\n');
    process.exit(1);
  }
  if (behavior === 'MISSING_JSON_FILE') {
    process.exit(0);
  }
  mkdirSync(dir, { recursive: true });
  const content = typeof behavior === 'string' ? behavior : JSON.stringify(behavior);
  writeFileSync(join(dir, 'native-client-certification.json'), content, 'utf8');
  process.exit(0);
}

process.stderr.write('fake gh: unhandled command ' + args.join(' ') + '\\n');
process.exit(1);
`;

let fakeGhDir: string;

function setUpFakeGh(fixture: Fixture): { fixturePath: string } {
  fakeGhDir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const ghPath = join(fakeGhDir, 'gh');
  writeFileSync(ghPath, FAKE_GH_SOURCE, 'utf8');
  chmodSync(ghPath, 0o755);
  // A .cmd batch shim would re-tokenize `&`-bearing GitHub API query strings through cmd.exe,
  // corrupting them. A .ps1 shim stays entirely inside PowerShell's own argument binding (both
  // for this script's own `gh ...` statements and for Get-Command's resolution), so it is used
  // on Windows instead; PATHEXT is extended below to make bare `gh` resolve to it.
  writeFileSync(
    join(fakeGhDir, 'gh.ps1'),
    `& node "$PSScriptRoot/gh" @args\nexit $LASTEXITCODE\n`,
    'utf8',
  );
  const fixturePath = join(fakeGhDir, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  return { fixturePath };
}

afterEach(() => {
  rmSync(fakeGhDir, { recursive: true, force: true });
});

function runAssert(fixture: Fixture, commitSha: string = COMMIT_SHA) {
  const { fixturePath } = setUpFakeGh(fixture);
  return spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Repository',
      REPOSITORY,
      '-CommitSha',
      commitSha,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeGhDir}${delimiter}${process.env['PATH'] ?? ''}`,
        Path: `${fakeGhDir}${delimiter}${process.env['Path'] ?? ''}`,
        PATHEXT: `${process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD'};.PS1`,
        GH_TOKEN: 'fake-token-for-tests',
        FAKE_GH_FIXTURE: fixturePath,
      },
    },
  );
}

function fixtureWithArtifact(artifact: unknown, overrides: Partial<Fixture> = {}): Fixture {
  return {
    runs: [successfulRun()],
    artifactsByRunId: {
      [RUN_ID]: [{ name: `native-client-certification-${COMMIT_SHA}`, id: 1, expired: false }],
    },
    artifactContentByRunId: { [RUN_ID]: artifact },
    ...overrides,
  };
}

describe('assert-native-client-certification.ps1', () => {
  it('accepts a fully valid, content-verified artifact', () => {
    const result = runAssert(fixtureWithArtifact(validArtifact()));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NATIVE_CLIENT_CERTIFICATION_EXACT_HEAD_QUALIFIED');
  });

  it('rejects when no workflow run matches the exact SHA at all', () => {
    const result = runAssert({ runs: [], artifactsByRunId: {}, artifactContentByRunId: {} });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Aucune certification native');
  });

  it('rejects when a run matches the SHA but carries no matching artifact', () => {
    const fixture = fixtureWithArtifact(validArtifact(), {
      artifactsByRunId: { [RUN_ID]: [{ name: 'some-other-artifact', id: 1, expired: false }] },
    });
    const result = runAssert(fixture);
    expect(result.status).not.toBe(0);
  });

  it('rejects an expired artifact even if the name matches', () => {
    const fixture = fixtureWithArtifact(validArtifact(), {
      artifactsByRunId: {
        [RUN_ID]: [{ name: `native-client-certification-${COMMIT_SHA}`, id: 1, expired: true }],
      },
    });
    const result = runAssert(fixture);
    expect(result.status).not.toBe(0);
  });

  it('rejects when the artifact exists and downloads but the download step itself fails, never treating existence as success', () => {
    const fixture = fixtureWithArtifact('DOWNLOAD_FAILS');
    const result = runAssert(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Aucune certification native');
  });

  it('rejects when the downloaded artifact is missing the expected JSON file', () => {
    const result = runAssert(fixtureWithArtifact('MISSING_JSON_FILE'));
    expect(result.status).not.toBe(0);
  });

  it('rejects invalid JSON inside the artifact', () => {
    const result = runAssert(fixtureWithArtifact('{not valid json'));
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('JSON invalide');
  });

  it.each([
    [
      'a mismatched artifact repository',
      validArtifact({ repository: 'someone-else/mcp-search-net' }),
      'repository mismatch',
    ],
    [
      'a mismatched artifact sourceRevision',
      validArtifact({ sourceRevision: OTHER_SHA }),
      'sourceRevision mismatch',
    ],
    [
      'a verdict other than PASS_NATIVE_3_OF_3',
      validArtifact({ verdict: 'PASS_NATIVE_2_OF_3' }),
      'PASS_NATIVE_3_OF_3',
    ],
    [
      'a malformed collectorReportSha256',
      validArtifact({ collectorReportSha256: 'not-a-hash' }),
      'collectorReportSha256 invalide',
    ],
    [
      'only 2 clients',
      validArtifact({}, [validClientEvidence('Claude Code'), validClientEvidence('Codex')]),
      'exactement 3 clients',
    ],
    [
      'a duplicated client',
      validArtifact({}, [
        validClientEvidence('Claude Code'),
        validClientEvidence('Claude Code'),
        validClientEvidence('Codex'),
      ]),
      // Not asserting on the accented "dupliqués": piping pwsh's console-encoded stderr
      // through spawnSync can mangle non-ASCII bytes on some hosts; this ASCII-only prefix of
      // the same message is enough to identify the failure reason unambiguously.
      'Artefact contient des clients',
    ],
    [
      'a 4th, unexpected client',
      validArtifact({}, [
        validClientEvidence('Claude Code'),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
        validClientEvidence('ChatGPT'),
      ]),
      'exactement 3 clients',
    ],
    [
      'a client with identical search/read requestIds',
      validArtifact({}, [
        validClientEvidence('Claude Code', { readRequestId: 'Claude Code-search' }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      // ASCII-only prefix; see the note above about accented characters and pipe capture.
      'searchRequestId et readRequestId',
    ],
    [
      'a client with sectionId <= 0',
      validArtifact({}, [
        validClientEvidence('Claude Code', { searchSectionId: 0, readSectionId: 0 }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      'searchSectionId invalide',
    ],
    [
      'a client with mismatched sectionIds',
      validArtifact({}, [
        validClientEvidence('Claude Code', { readSectionId: 9 }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      'sectionId mismatch',
    ],
    [
      'a client with sectionFound=false',
      validArtifact({}, [
        validClientEvidence('Claude Code', { sectionFound: false }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      'sectionFound',
    ],
    [
      'a client with nativeToolInvocationObserved=false',
      validArtifact({}, [
        validClientEvidence('Claude Code', { nativeToolInvocationObserved: false }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      'nativeToolInvocationObserved',
    ],
    [
      'a client verdict other than PASS_NATIVE',
      validArtifact({}, [
        validClientEvidence('Claude Code', { verdict: 'FAIL' }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      'PASS_NATIVE',
    ],
    [
      'a client sourceRevision that does not match the exact SHA',
      validArtifact({}, [
        validClientEvidence('Claude Code', { sourceRevision: OTHER_SHA }),
        validClientEvidence('Claude Desktop'),
        validClientEvidence('Codex'),
      ]),
      'sourceRevision doit correspondre',
    ],
  ] as const)('rejects %s', (_label, artifact, expectedMessage) => {
    const result = runAssert(fixtureWithArtifact(artifact));
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain(expectedMessage);
  });

  it('never accepts an artifact from existence alone: a syntactically perfect name with content mismatch is refused', () => {
    // The historical AUD-01 gap: "an artifact of the right name exists" used to be the entire
    // check. This asserts the fix by feeding an artifact that exists, is named exactly right,
    // is not expired, downloads successfully, and is valid JSON -- yet fails one content
    // invariant (wrong repository) -- and confirming that alone is enough to refuse it.
    const result = runAssert(fixtureWithArtifact(validArtifact({ repository: 'not/this-repo' })));
    expect(result.status).not.toBe(0);
  });
});
