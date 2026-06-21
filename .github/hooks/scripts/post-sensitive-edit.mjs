import process from 'node:process';

const input = await readInput();
const paths = input === undefined ? [] : collectPaths(input.toolArgs ?? input.tool_input);
const sensitive = paths.filter((path) =>
  /(?:^|[\\/])(?:src[\\/]infrastructure[\\/](?:security|http|fetch)|config|scripts|\.github[\\/](?:hooks|workflows))(?:[\\/]|$)|(?:^|[\\/])(?:compose\.yaml|Dockerfile|package(?:-lock)?\.json)$/iu.test(
    path,
  ),
);

if (sensitive.length === 0) {
  process.stdout.write('{}\n');
} else {
  const reminders = buildReminders(sensitive);
  const additionalContext = [
    'A security/deployment-sensitive file changed. Apply the relevant guardrails before finishing:',
    ...reminders,
  ].join('\n');
  process.stdout.write(`${JSON.stringify({ additionalContext })}\n`);
}

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += String(chunk);
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function collectPaths(value) {
  if (value === null || typeof value !== 'object') return [];
  const paths = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (/^(?:file_?path|path|target|filename)$/iu.test(key) && typeof candidate === 'string') {
      paths.push(candidate);
    } else if (key !== 'content' && key !== 'text') {
      paths.push(...collectPaths(candidate));
    }
  }
  return paths;
}

function buildReminders(paths) {
  const reminders = new Set([
    '- Re-read applicable instructions and keep stdout reserved for MCP JSON-RPC only.',
  ]);

  for (const path of paths) {
    if (/(?:^|[\\/])\.github[\\/]agents(?:[\\/]|$)/iu.test(path)) {
      reminders.add('- Validate agent front matter: description, owner, version, lastReviewed.');
    }
    if (/(?:^|[\\/])\.github[\\/]prompts(?:[\\/]|$)/iu.test(path)) {
      reminders.add('- Validate prompt front matter and keep agent references consistent.');
    }
    if (/(?:^|[\\/])\.github[\\/]instructions(?:[\\/]|$)/iu.test(path)) {
      reminders.add('- Validate instruction front matter and confirm applyTo targets are correct.');
    }
    if (
      /(?:^|[\\/])(?:scripts[\\/]validate-copilot-config\.mjs|\.github[\\/]hooks)(?:[\\/]|$)/iu.test(
        path,
      )
    ) {
      reminders.add('- Run npm run check:copilot to verify front matters and hook JSON integrity.');
    }
    if (/(?:^|[\\/])src[\\/]infrastructure[\\/](?:security|http|fetch)(?:[\\/]|$)/iu.test(path)) {
      reminders.add('- Add hostile/boundary tests and ensure blocked targets are never contacted.');
    }
    if (
      /(?:^|[\\/])(?:compose\.yaml|Dockerfile|config[\\/]|scripts[\\/]|\.github[\\/]workflows)(?:[\\/]|$)/iu.test(
        path,
      )
    ) {
      reminders.add('- Recheck deployment hardening, secret handling, and reproducible commands.');
    }
  }

  reminders.add('- Run npm run check before completion for cross-layer or tooling updates.');
  return [...reminders];
}
