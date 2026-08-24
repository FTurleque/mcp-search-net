import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const releaseWorkflow = readText('.github/workflows/release-windows.yml');
const certificationWorkflow = readText('.github/workflows/native-client-certification-record.yml');
const certificationGate = readText('scripts/release/assert-native-client-certification.ps1');
const signingScript = readText('scripts/release/sign-windows-setup.ps1');
const contentFetcher = readText('src/infrastructure/fetch/crawl4ai-content-fetcher.ts');
const failures = [];

requireText(
  releaseWorkflow,
  'runs?branch=master&event=push&head_sha=$env:GITHUB_SHA&status=completed&per_page=20',
  'release-windows: push/master exact-head query missing',
);
requireText(
  releaseWorkflow,
  "$_.head_branch -eq 'master'",
  'release-windows: master branch filter missing',
);
requireText(releaseWorkflow, "$_.event -eq 'push'", 'release-windows: push event filter missing');
for (const job of [
  'Node.js 24 validation',
  'Docker integration and live E2E',
  'Windows installation and STDIO packaging',
  'SonarCloud Code Analysis',
]) {
  requireText(releaseWorkflow, `'${job}'`, `release-windows: required CI job missing: ${job}`);
}
assert(
  !releaseWorkflow.includes('runs?head_sha=$env:GITHUB_SHA&status=completed&per_page=20'),
  'release-windows: event-agnostic exact-head query is forbidden',
);

requireText(
  releaseWorkflow,
  'assert-native-client-certification.ps1',
  'release-windows: exact-head native certification gate missing',
);
for (const invariant of [
  'authenticode:',
  'default: false',
  '!inputs.validate_only && inputs.authenticode',
  'WINDOWS_SIGNING_CERTIFICATE_BASE64',
  'WINDOWS_SIGNING_CERTIFICATE_PASSWORD',
  'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT',
  'AUTHENTICODE_ENABLED: ${{ inputs.authenticode }}',
  "if ($env:AUTHENTICODE_ENABLED -eq 'true')",
  'Publication volontaire du setup Windows sans Authenticode.',
]) {
  requireText(
    releaseWorkflow,
    invariant,
    `release-windows: optional/default-off Authenticode contract missing: ${invariant}`,
  );
}
requireText(
  releaseWorkflow,
  'Verify-Sha256 $setup $setupChecksum',
  'release-windows: setup SHA-256 verification missing',
);
requireText(
  releaseWorkflow,
  'actions/attest-build-provenance@9d57eef8c06cd9d6b433effeeb7a6a77b3ff94ad',
  'release-windows: pinned build provenance action missing',
);
requireText(
  releaseWorkflow,
  'gh attestation verify $artifact --repo $env:GITHUB_REPOSITORY',
  'release-windows: publish-time provenance verification missing',
);

for (const client of ['Claude Code', 'Claude Desktop', 'Codex']) {
  requireText(
    certificationWorkflow,
    `'${client}'`,
    `native certification: required client missing: ${client}`,
  );
}
for (const proof of [
  'nativeToolInvocationObserved',
  'PASS_NATIVE',
  'PASS_NATIVE_3_OF_3',
  'searchSectionId',
  'readSectionId',
]) {
  requireText(
    certificationWorkflow,
    proof,
    `native certification: proof invariant missing: ${proof}`,
  );
}
requireText(
  certificationWorkflow,
  'native-client-certification-${{ github.sha }}',
  'native certification: artifact must be bound to exact GitHub SHA',
);
requireText(
  certificationGate,
  'native-client-certification-$CommitSha',
  'native certification gate: exact-head artifact name missing',
);
requireText(
  certificationGate,
  '[string]$_.head_sha -eq $CommitSha',
  'native certification gate: exact SHA comparison missing',
);
requireText(
  signingScript,
  'signtool sign /fd SHA256 /td SHA256 /tr',
  'Windows signing: SHA-256 timestamped signing command missing',
);
requireText(
  signingScript,
  "[string]$signature.Status -ne 'Valid'",
  'Windows signing: Authenticode status verification missing',
);

requireText(
  contentFetcher,
  'throw new UnsupportedContentTypeError();',
  'content fetcher: stable unsupported content type error missing',
);
assert(
  !contentFetcher.includes('Unsupported content type: ${contentType}'),
  'content fetcher: remote Content-Type must not be reflected into error text',
);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ status: 'AUDIT_RELEASE_BOUNDARY_PASSED' })}\n`);
}

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function requireText(text, needle, message) {
  assert(text.includes(needle), message);
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}
