import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const roadmap = readFileSync('docs/planning/roadmap-v1-operationnelle.md', 'utf8');
const git = spawnSync('git', ['status', '--short', '--branch'], {
  encoding: 'utf8',
  shell: false,
});

const completed = (roadmap.match(/^- \[x\]/gmu) ?? []).length;
const pending = (roadmap.match(/^- \[ \]/gmu) ?? []).length;

const snapshot = {
  project: packageJson.name,
  version: packageJson.version,
  requiredNode: packageJson.engines?.node,
  currentNode: process.versions.node,
  gitStatus: git.stdout.trim().split(/\r?\n/u).filter(Boolean),
  roadmap: { completed, pending },
  validationCommand: 'npm run check',
  liveTests: {
    search: 'RUN_LIVE_SEARXNG=1 npm test -- tests/e2e/mcp-live-search.test.ts',
    fetch: 'RUN_LIVE_CRAWL4AI=1 npm test -- tests/e2e/mcp-live.test.ts',
  },
};

process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
