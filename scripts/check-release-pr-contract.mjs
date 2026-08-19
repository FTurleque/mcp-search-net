import process from 'node:process';

const body = process.env.RELEASE_PR_BODY ?? '';
const headSha = (process.env.RELEASE_PR_HEAD_SHA ?? '').trim().toLowerCase();
const sourceBranch = process.env.RELEASE_PR_HEAD_REF ?? '';
const targetBranch = process.env.RELEASE_PR_BASE_REF ?? '';
const POLICY_MARKER = '<!-- release-qualification-source: github-checks-current-head -->';
const COMMIT_SHA_PATTERN = /\b[a-f0-9]{40}\b/giu;

if (sourceBranch !== 'develop' || targetBranch !== 'master') {
  writeStatus('RELEASE_PR_CONTRACT_NOT_APPLICABLE', { sourceBranch, targetBranch });
  process.exit(0);
}

assert(/^[a-f0-9]{40}$/u.test(headSha), 'RELEASE_PR_HEAD_SHA_INVALID');
assert(body.includes(POLICY_MARKER), 'RELEASE_PR_CURRENT_HEAD_POLICY_MARKER_MISSING');

const qualificationSection = markdownSection(body, 'Qualification du candidat courant');
assert(qualificationSection !== undefined, 'RELEASE_PR_QUALIFICATION_SECTION_MISSING');
const pinnedShas = qualificationSection.match(COMMIT_SHA_PATTERN) ?? [];
assert(pinnedShas.length === 0, 'RELEASE_PR_QUALIFICATION_SECTION_MUST_NOT_PIN_SHA');

for (const forbidden of [
  /Tous les workflows[^\n]*SUCCESS/iu,
  /\bCI\s*#\d+/iu,
  /\brun\s+\d{5,}/iu,
  /HEAD\s+courant[^\n]*[a-f0-9]{40}/iu,
]) {
  assert(!forbidden.test(qualificationSection), 'RELEASE_PR_MUTABLE_QUALIFICATION_FORBIDDEN');
}

for (const required of [
  'Source de vérité unique',
  'checks GitHub',
  'HEAD courant',
  'Windows installation and STDIO packaging',
  'Native client certification smoke',
  'Catalog backup durability',
  'Windows in-place upgrade',
]) {
  const present = qualificationSection.includes(required);
  assert(present, `RELEASE_PR_REQUIREMENT_MISSING:${required}`);
}

const mergeSection = markdownSection(body, 'Règle de merge');
assert(mergeSection !== undefined, 'RELEASE_PR_MERGE_RULE_SECTION_MISSING');
const explicitAuthorization = mergeSection.includes(
  "aucune autorisation explicite de merge n'a été donnée",
);
assert(explicitAuthorization, 'RELEASE_PR_MERGE_AUTHORIZATION_RULE_MISSING');
const exactHeadRule = mergeSection.includes('HEAD exact de la PR');
assert(exactHeadRule, 'RELEASE_PR_EXACT_HEAD_RULE_MISSING');

writeStatus('RELEASE_PR_CONTRACT_VALID', { headSha, sourceBranch, targetBranch });

function writeStatus(status, details) {
  process.stdout.write(`${JSON.stringify({ status, ...details })}\n`);
}

function markdownSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/u);
  const headingLine = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
