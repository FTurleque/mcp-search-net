import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const currentStatePath = resolve(import.meta.dirname, '..', 'docs/status/current-state.md');
const projectMapPath = resolve(
  import.meta.dirname,
  '..',
  '.github/skills/maintain-mcp-search-net/references/project-map.md',
);
const currentState = readFileSync(currentStatePath, 'utf8');
const projectMap = readFileSync(projectMapPath, 'utf8');
const failures = [];

for (const [pattern, description] of [
  [/candidat post-audit/iu, 'candidat post-audit éphémère'],
  [/branche de correction/iu, 'branche de correction éphémère'],
  [/avant (?:le )?merge explicite/iu, 'vérité conditionnée au prochain merge'],
  [
    /corrections? (?:ne sont|n’est) pas (?:encore )?(?:intégrées?|mergées?)/iu,
    'statut de merge dynamique',
  ],
]) {
  if (pattern.test(currentState)) failures.push(description);
}

for (const [needle, description] of [
  ['preuves historiques datées', 'qualification formulée comme preuve historique'],
  ['Git et GitHub restent l’autorité', 'autorité live Git/GitHub'],
]) {
  if (!currentState.includes(needle)) failures.push(`invariant absent: ${description}`);
}

const publicTools = [
  'search_web',
  'fetch_url',
  'search_docs',
  'list_docs',
  'read_doc_section',
  'list_search_history',
];
for (const tool of publicTools) {
  if (!projectMap.includes(tool)) failures.push(`project-map: outil public absent ${tool}`);
}

if (failures.length > 0) {
  process.stderr.write(`CURRENT_STATE_DURABILITY_CHECK_FAILED (${failures.length})\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ status: 'CURRENT_STATE_DURABILITY_CHECK_PASSED' }, null, 2)}\n`,
);
