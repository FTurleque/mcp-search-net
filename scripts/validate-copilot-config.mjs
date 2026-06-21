import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

import { parse } from 'yaml';

const root = resolve('.');
const github = join(root, '.github');
const agentsDirectory = join(github, 'agents');
const promptsDirectory = join(github, 'prompts');
const instructionsDirectory = join(github, 'instructions');
const skillsDirectory = join(github, 'skills');
const hooksDirectory = join(github, 'hooks');
const errors = [];
const ownerPattern = /^[A-Za-z0-9._-]+$/u;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

const agents = markdownFiles(agentsDirectory, '.agent.md');
const prompts = markdownFiles(promptsDirectory, '.prompt.md');
const instructions = markdownFiles(instructionsDirectory, '.instructions.md');
const skills = markdownFiles(skillsDirectory, 'SKILL.md');

for (const file of agents) {
  const metadata = frontmatter(file);
  requireString(metadata, 'name', file);
  requireString(metadata, 'description', file);
  validateEnrichedMetadata(metadata, file);
  if (
    metadata.tools !== undefined &&
    !Array.isArray(metadata.tools) &&
    typeof metadata.tools !== 'string'
  ) {
    errors.push(`${display(file)}: tools must be a list or comma-separated string`);
  }
  if (metadata.infer !== undefined)
    errors.push(`${display(file)}: deprecated infer property is forbidden`);
}

const agentIds = new Set(agents.map((file) => basename(file, '.agent.md')));
for (const file of prompts) {
  const metadata = frontmatter(file);
  requireString(metadata, 'name', file);
  requireString(metadata, 'description', file);
  validateEnrichedMetadata(metadata, file);
  if (
    metadata.agent !== undefined &&
    metadata.agent !== 'agent' &&
    !agentIds.has(String(metadata.agent))
  ) {
    errors.push(`${display(file)}: unknown agent '${metadata.agent}'`);
  }
}

for (const file of instructions) {
  const metadata = frontmatter(file);
  requireString(metadata, 'name', file);
  requireString(metadata, 'description', file);
  requireString(metadata, 'applyTo', file);
  validateEnrichedMetadata(metadata, file);
}

for (const file of skills) {
  const metadata = frontmatter(file);
  requireString(metadata, 'name', file);
  requireString(metadata, 'description', file);
  validateEnrichedMetadata(metadata, file);
  const folder = basename(dirname(file));
  if (metadata.name !== folder)
    errors.push(`${display(file)}: skill name must match folder '${folder}'`);
}

for (const file of jsonFiles(hooksDirectory)) validateHookFile(file);

for (const file of [...agents, ...prompts, ...instructions, ...skills]) {
  if (/\bTODO\b/u.test(readFileSync(file, 'utf8')))
    errors.push(`${display(file)}: unresolved TODO marker`);
}

if (errors.length > 0) {
  process.stderr.write(`Copilot configuration is invalid:\n- ${errors.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Copilot configuration validated: ${agents.length} agents, ${prompts.length} prompts, ${instructions.length} path instructions, ${skills.length} skill(s).\n`,
  );
}

function markdownFiles(directory, suffix) {
  return filesRecursively(directory).filter((file) => file.endsWith(suffix));
}

function jsonFiles(directory) {
  return filesRecursively(directory).filter(
    (file) => extname(file) === '.json' && dirname(file) === directory,
  );
}

function filesRecursively(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

function frontmatter(file) {
  const content = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (match === null) {
    errors.push(`${display(file)}: missing YAML frontmatter`);
    return {};
  }
  try {
    return parse(match[1]) ?? {};
  } catch (error) {
    errors.push(
      `${display(file)}: invalid YAML (${error instanceof Error ? error.message : error})`,
    );
    return {};
  }
}

function requireString(metadata, key, file) {
  if (typeof metadata[key] !== 'string' || metadata[key].trim() === '') {
    errors.push(`${display(file)}: '${key}' must be a non-empty string`);
  }
}

function validateEnrichedMetadata(metadata, file) {
  requireString(metadata, 'owner', file);
  requireString(metadata, 'version', file);
  requireString(metadata, 'lastReviewed', file);

  if (typeof metadata.owner === 'string' && !ownerPattern.test(metadata.owner)) {
    errors.push(`${display(file)}: 'owner' contains unsupported characters`);
  }

  if (typeof metadata.version === 'string' && !semverPattern.test(metadata.version)) {
    errors.push(`${display(file)}: 'version' must follow SemVer (e.g. 1.0.0)`);
  }

  if (typeof metadata.lastReviewed === 'string' && !isIsoDate(metadata.lastReviewed)) {
    errors.push(`${display(file)}: 'lastReviewed' must use YYYY-MM-DD`);
  }
}

function isIsoDate(value) {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateHookFile(file) {
  let configuration;
  try {
    configuration = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(
      `${display(file)}: invalid JSON (${error instanceof Error ? error.message : error})`,
    );
    return;
  }
  if (configuration.version !== 1) errors.push(`${display(file)}: version must be 1`);
  if (configuration.hooks === null || typeof configuration.hooks !== 'object') {
    errors.push(`${display(file)}: hooks must be an object`);
    return;
  }
  for (const [event, entries] of Object.entries(configuration.hooks)) {
    if (!Array.isArray(entries)) {
      errors.push(`${display(file)}: hook event '${event}' must contain an array`);
      continue;
    }
    for (const entry of entries) {
      if (entry?.type !== 'command')
        errors.push(`${display(file)}: ${event} hook must use type command`);
      for (const shell of ['bash', 'powershell']) {
        if (typeof entry?.[shell] !== 'string') {
          errors.push(`${display(file)}: ${event} hook must define ${shell}`);
          continue;
        }
        const script = /\bnode\s+([^\s]+\.mjs)\b/u.exec(entry[shell])?.[1];
        if (script !== undefined && !existsSync(join(root, script))) {
          errors.push(`${display(file)}: referenced hook script does not exist: ${script}`);
        }
      }
      if (!Number.isFinite(entry?.timeoutSec) || entry.timeoutSec <= 0) {
        errors.push(`${display(file)}: ${event} timeoutSec must be positive`);
      }
    }
  }
}

function display(file) {
  return relative(root, file).replaceAll('\\', '/');
}
