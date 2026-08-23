import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const githubEvent = readGithubEvent();
const body = process.env.RELEASE_PR_BODY ?? githubEvent?.pull_request?.body ?? '';
const headSha = (process.env.RELEASE_PR_HEAD_SHA ?? githubEvent?.pull_request?.head?.sha ?? '')
  .trim()
  .toLowerCase();
const sourceBranch = process.env.RELEASE_PR_HEAD_REF ?? githubEvent?.pull_request?.head?.ref ?? '';
const targetBranch = process.env.RELEASE_PR_BASE_REF ?? githubEvent?.pull_request?.base?.ref ?? '';
const verifyTopology = process.env.RELEASE_PR_VERIFY_TOPOLOGY === '1';
const POLICY_MARKER = '<!-- release-qualification-source: github-checks-current-head -->';
const COMMIT_SHA_PATTERN = /\b[a-f0-9]{40}\b/giu;
const PROMOTION_BRANCH_PATTERN =
  /^release\/promote-develop-\d{8}-\d{6}(?:-[a-z0-9][a-z0-9-]*)?$/u;

if (targetBranch !== 'master') {
  writeStatus('RELEASE_PR_CONTRACT_NOT_APPLICABLE', { sourceBranch, targetBranch });
  process.exit(0);
}

assert(PROMOTION_BRANCH_PATTERN.test(sourceBranch), 'RELEASE_PR_SOURCE_BRANCH_INVALID');
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

const topology = verifyTopology ? verifyPromotionTopology(headSha) : undefined;
writeStatus('RELEASE_PR_CONTRACT_VALID', {
  headSha,
  sourceBranch,
  targetBranch,
  ...(topology === undefined ? {} : topology),
});

function verifyPromotionTopology(expectedHeadSha) {
  const actualHeadSha = gitOutput(['rev-parse', 'HEAD']).toLowerCase();
  assert(actualHeadSha === expectedHeadSha, 'RELEASE_PR_CHECKOUT_HEAD_MISMATCH');

  const developSha = gitOutput(['rev-parse', 'origin/develop']).toLowerCase();
  const masterSha = gitOutput(['rev-parse', 'origin/master']).toLowerCase();
  const parentSha = gitOutput(['rev-parse', 'HEAD^']).toLowerCase();
  const headTree = gitOutput(['rev-parse', 'HEAD^{tree}']).toLowerCase();
  const developTree = gitOutput(['rev-parse', 'origin/develop^{tree}']).toLowerCase();

  assert(parentSha === developSha, 'RELEASE_PR_HEAD_NOT_DIRECTLY_ON_CURRENT_DEVELOP');
  assert(headTree === developTree, 'RELEASE_PR_HEAD_TREE_DIFFERS_FROM_DEVELOP');
  assert(
    gitSucceeds(['merge-base', '--is-ancestor', 'origin/master', 'origin/develop']),
    'RELEASE_PR_MASTER_NOT_SYNCED_INTO_DEVELOP',
  );

  const commitsAboveDevelop = Number.parseInt(
    gitOutput(['rev-list', '--count', 'origin/develop..HEAD']),
    10,
  );
  assert(commitsAboveDevelop === 1, 'RELEASE_PR_PROMOTION_MARKER_COMMIT_COUNT_INVALID');
  assert(
    gitSucceeds(['diff', '--quiet', 'origin/develop', 'HEAD', '--']),
    'RELEASE_PR_PROMOTION_MARKER_MUST_NOT_CHANGE_CONTENT',
  );

  return { developSha, masterSha, promotionMarkerCommits: commitsAboveDevelop };
}

function gitOutput(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `RELEASE_PR_GIT_COMMAND_FAILED:${args.join(' ')}:${String(result.stderr).trim()}`,
    );
  }
  return String(result.stdout).trim();
}

function gitSucceeds(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0;
}

function readGithubEvent() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return undefined;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === '') return undefined;
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (error) {
    throw new Error('RELEASE_PR_GITHUB_EVENT_INVALID', { cause: error });
  }
}

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
