import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/native-client-certification-record.yml';
const workflowYaml = readFileSync(workflowPath, 'utf8');

interface NativeEvidence {
  schemaVersion: string;
  client: string;
  clientVersion: string;
  os: string;
  serverVersion: string;
  sourceRevision: string;
  sourceState: string;
  nodeVersion: string;
  searchRequestId: string;
  readRequestId: string;
  searchSectionId: number;
  readSectionId: number;
  sectionFound: boolean;
  truncated: boolean;
  characterCount: number;
  nativeToolInvocationObserved: boolean;
  observedAt: string;
  verdict: string;
}

// The workflow script asserts `git rev-parse HEAD` (run against this checkout) equals the
// declared GITHUB_SHA, mirroring the real "exact-head checkout" guard -- so the "valid"
// baseline must use this checkout's actual HEAD rather than an arbitrary fixed SHA.
const SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const OTHER_SHA = SHA.slice(0, -1) + (SHA.endsWith('0') ? '1' : '0');

function baseEvidence(client: string, overrides: Partial<NativeEvidence> = {}): NativeEvidence {
  return {
    schemaVersion: '1.0',
    client,
    clientVersion: '2.1.240',
    os: 'Windows 10 Pro',
    serverVersion: '1.1.4',
    sourceRevision: SHA,
    sourceState: 'CLEAN',
    nodeVersion: '24.18.0',
    searchRequestId: 'req-search-1',
    readRequestId: 'req-read-1',
    searchSectionId: 8,
    readSectionId: 8,
    sectionFound: true,
    truncated: false,
    characterCount: 1234,
    nativeToolInvocationObserved: true,
    observedAt: new Date('2026-08-22T12:00:00.000Z').toISOString(),
    verdict: 'PASS_NATIVE',
    ...overrides,
  };
}

function baseCollectorReport(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    serverName: 'mcp-search-net',
    serverVersion: '1.1.4',
    sourceRevision: SHA,
    generatedAt: new Date('2026-08-22T12:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result;
}

let scriptPath: string;
let workDir: string;

beforeAll(() => {
  const doc = parse(workflowYaml) as {
    jobs: { record: { steps: { run?: string }[] } };
  };
  const step = doc.jobs.record.steps.find(
    (s) => typeof s.run === 'string' && s.run.includes('Read-NativeEvidence'),
  );
  if (step?.run === undefined) throw new Error('Could not locate the validation step run block');
  workDir = mkdtempSync(join(tmpdir(), 'native-cert-record-'));
  scriptPath = join(workDir, 'record.ps1');
  writeFileSync(scriptPath, step.run, 'utf8');
});

afterEach(() => {
  rmSync(join(workDir, 'runner-temp'), { recursive: true, force: true });
});

function run(options: {
  claudeCode?: Partial<NativeEvidence> | 'MISSING';
  claudeDesktop?: Partial<NativeEvidence> | 'MISSING';
  codex?: Partial<NativeEvidence> | 'MISSING';
  collector?: Record<string, unknown> | 'MISSING' | 'INVALID_JSON';
  githubSha?: string;
}) {
  const runnerTemp = join(workDir, 'runner-temp');
  const githubEnvPath = join(workDir, 'github-env.txt');
  rmSync(runnerTemp, { recursive: true, force: true });
  rmSync(githubEnvPath, { force: true });

  const toEvidenceJson = (
    value: Partial<NativeEvidence> | 'MISSING' | undefined,
    client: string,
  ) => {
    if (value === 'MISSING') return '';
    return JSON.stringify(baseEvidence(client, value ?? {}));
  };
  const collectorJson =
    options.collector === 'MISSING'
      ? ''
      : options.collector === 'INVALID_JSON'
        ? '{not valid json'
        : JSON.stringify(stripUndefined(baseCollectorReport(options.collector ?? {})));

  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_SHA: options.githubSha ?? SHA,
        GITHUB_REPOSITORY: 'FTurleque/mcp-search-net',
        GITHUB_ACTOR: 'test-actor',
        RUNNER_TEMP: runnerTemp,
        GITHUB_ENV: githubEnvPath,
        CLAUDE_CODE_EVIDENCE: toEvidenceJson(options.claudeCode, 'Claude Code'),
        CLAUDE_DESKTOP_EVIDENCE: toEvidenceJson(options.claudeDesktop, 'Claude Desktop'),
        CODEX_EVIDENCE: toEvidenceJson(options.codex, 'Codex'),
        COLLECTOR_REPORT_JSON: collectorJson,
      },
    },
  );
  return result;
}

const ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_SGR_PATTERN = new RegExp(ESCAPE_CHARACTER + String.raw`\[[0-9;]*m`, 'gu');
const WRAPPED_CONTINUATION_LINE_PATTERN = /\r?\n\s*\|?\s*/gu;
const WHITESPACE_RUN_PATTERN = /\s+/gu;

function normalizePwshOutput(value: string): string {
  return value
    .replace(ANSI_SGR_PATTERN, '') // strip ANSI SGR color codes
    .replace(WRAPPED_CONTINUATION_LINE_PATTERN, ' ') // join a wrapped continuation line (drops the "| " marker)
    .replace(WHITESPACE_RUN_PATTERN, ' ')
    .trim();
}

function assertContains(result: SpawnSyncReturns<string>, expected: string): void {
  // pwsh wraps long error messages across lines to fit the host's console width, and where that
  // wrap point falls depends on the runner's terminal width -- it can land inside the very
  // phrase being asserted on. Each wrapped continuation line is also rendered with ANSI color
  // codes and a "     | " marker interposed (observed in CI: "...contient un JSON\n     |
  // invalide : ..." instead of "...JSON invalide : ..."), so a bare whitespace collapse is not
  // enough; strip the ANSI/marker noise first, then join wrapped lines with a single space.
  const combined = normalizePwshOutput(`${result.stderr}${result.stdout}`);
  if (!combined.includes(normalizePwshOutput(expected))) {
    throw new Error(
      `Expected output to contain ${JSON.stringify(expected)} but did not.\n` +
        `status=${String(result.status)}\n` +
        `stdout=${JSON.stringify(result.stdout)}\n` +
        `stderr=${JSON.stringify(result.stderr)}`,
    );
  }
}

function readArtifact(): Record<string, unknown> {
  const envContent = readFileSync(join(workDir, 'github-env.txt'), 'utf8');
  const match = /NATIVE_CERTIFICATION_PATH=(.+)/.exec(envContent);
  if (match?.[1] === undefined) throw new Error('Artifact path not recorded');
  return JSON.parse(readFileSync(match[1].trim(), 'utf8')) as Record<string, unknown>;
}

describe('native-client-certification-record.yml validation logic', () => {
  it('accepts a valid 3/3 submission and records a well-formed artifact', () => {
    const result = run({});
    expect(result.status).toBe(0);
    const artifact = readArtifact();
    expect(artifact['verdict']).toBe('PASS_NATIVE_3_OF_3');
    expect(artifact['sourceRevision']).toBe(SHA);
    expect(artifact['collectorReportSha256']).toMatch(/^[a-f0-9]{64}$/);
    const clients = artifact['clients'] as Record<string, unknown>[];
    expect(clients).toHaveLength(3);
    expect(clients.map((c) => c['client'])).toEqual(['Claude Code', 'Claude Desktop', 'Codex']);
    for (const client of clients) {
      expect(client['sourceRevision']).toBe(SHA);
      expect(client['sourceState']).toBe('CLEAN');
      expect(client['verdict']).toBe('PASS_NATIVE');
    }
  });

  it('recomputes the collector report hash instead of trusting a declared one', () => {
    const result = run({});
    expect(result.status).toBe(0);
    const artifact = readArtifact();
    const expectedHash = createHash('sha256')
      .update(JSON.stringify(baseCollectorReport()), 'utf8')
      .digest('hex');
    expect(artifact['collectorReportSha256']).toBe(expectedHash);
  });

  it.each([
    [
      'a client sourceRevision that does not match github.sha',
      { claudeCode: { sourceRevision: OTHER_SHA } },
      'does not match the certified head',
    ],
    [
      'a duplicated client name',
      { claudeDesktop: { client: 'Claude Code' } },
      'Unexpected client name',
    ],
    [
      'a client name outside the certified set',
      { codex: { client: 'ChatGPT Desktop' } },
      'Unexpected client name',
    ],
    [
      'identical search/read requestIds',
      { claudeCode: { readRequestId: 'req-search-1' } },
      'must differ',
    ],
    ['an empty searchRequestId', { claudeCode: { searchRequestId: '' } }, 'Missing or empty'],
    ['a zero searchSectionId', { claudeCode: { searchSectionId: 0 } }, 'Invalid searchSectionId'],
    ['a negative readSectionId', { claudeCode: { readSectionId: -1 } }, 'Invalid readSectionId'],
    [
      'mismatched search/read sectionIds',
      { claudeCode: { readSectionId: 9 } },
      'sectionId mismatch',
    ],
    ['sectionFound=false', { claudeCode: { sectionFound: false } }, 'sectionFound must be true'],
    [
      'nativeToolInvocationObserved=false',
      { claudeCode: { nativeToolInvocationObserved: false } },
      'was not observed',
    ],
    [
      'a verdict other than PASS_NATIVE',
      { claudeCode: { verdict: 'PASS' } },
      'must be PASS_NATIVE',
    ],
    ['sourceState other than CLEAN', { claudeCode: { sourceState: 'DIRTY' } }, 'must be CLEAN'],
    [
      'a malformed sourceRevision (not 40 hex chars)',
      { claudeCode: { sourceRevision: 'not-a-sha' } },
      'Invalid sourceRevision',
    ],
  ] as const)('rejects %s', (_label, overrides, expectedMessage) => {
    const result = run(overrides);
    expect(result.status).not.toBe(0);
    assertContains(result, expectedMessage);
  });

  it('rejects a missing client evidence input', () => {
    const result = run({ codex: 'MISSING' });
    expect(result.status).not.toBe(0);
    assertContains(result, 'Invalid JSON evidence');
  });

  it('rejects invalid collector report JSON', () => {
    const result = run({ collector: 'INVALID_JSON' });
    expect(result.status).not.toBe(0);
    assertContains(result, 'Invalid collector report JSON');
  });

  it('rejects a missing collector report', () => {
    const result = run({ collector: 'MISSING' });
    expect(result.status).not.toBe(0);
    assertContains(result, 'collector_report_json is required');
  });

  it('rejects a collector report whose sourceRevision does not match github.sha', () => {
    const result = run({ collector: { sourceRevision: OTHER_SHA } });
    expect(result.status).not.toBe(0);
    assertContains(result, 'Collector report sourceRevision');
  });

  it('rejects a collector report with the wrong serverName', () => {
    const result = run({ collector: { serverName: 'not-mcp-search-net' } });
    expect(result.status).not.toBe(0);
    assertContains(result, 'unexpected serverName');
  });

  it('rejects a collector report missing a required field', () => {
    const result = run({ collector: { serverVersion: undefined } });
    expect(result.status).not.toBe(0);
    assertContains(result, 'missing required field');
  });

  it('does not accept the artifact when only Claude Code and Claude Desktop match github.sha but Codex does not', () => {
    const result = run({ codex: { sourceRevision: OTHER_SHA } });
    expect(result.status).not.toBe(0);
    assertContains(result, 'does not match the certified head');
  });
});
