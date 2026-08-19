import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const releaseWorkflow = readText('.github/workflows/release-windows.yml');
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
requireText(
  releaseWorkflow,
  "$_.event -eq 'push'",
  'release-windows: push event filter missing',
);
for (const job of [
  'Node.js 24 validation',
  'Docker integration and live E2E',
  'Windows installation and STDIO packaging',
  'SonarCloud Code Analysis',
]) {
  requireText(releaseWorkflow, `'${job}'`, `release-windows: required CI job missing: ${job}`);
}
assert(
  !releaseWorkflow.includes(
    'runs?head_sha=$env:GITHUB_SHA&status=completed&per_page=20',
  ),
  'release-windows: event-agnostic exact-head query is forbidden',
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
