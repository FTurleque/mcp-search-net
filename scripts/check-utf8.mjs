import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const ROOTS = [
  'src',
  'tests',
  'scripts',
  'packaging',
  '.github',
  'docs',
  'config',
  'migrations',
  'catalog-migrations',
  'history-migrations',
];

const TEXT_EXTENSIONS = new Set([
  '.bat',
  '.cjs',
  '.cmd',
  '.css',
  '.example',
  '.html',
  '.iss',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.npmrc',
  '.properties',
  '.ps1',
  '.psm1',
  '.sh',
  '.sql',
  '.template',
  '.toml',
  '.ts',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_FILE_NAMES = new Set([
  '.dockerignore',
  '.npmrc',
  'Dockerfile',
  'LICENSE',
  'NOTICE',
]);

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.data',
  '.scannerwork',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

const decoder = new TextDecoder('utf-8', { fatal: true });
const failures = [];
let checked = 0;

function shouldCheck(path) {
  const name = path.split(/[\\/]/u).at(-1) ?? path;
  return TEXT_FILE_NAMES.has(name) || TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

function scan(path) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    const name = path.split(/[\\/]/u).at(-1) ?? path;
    if (SKIPPED_DIRECTORIES.has(name)) return;
    for (const entry of readdirSync(path)) scan(join(path, entry));
    return;
  }
  if (!stat.isFile() || !shouldCheck(path)) return;

  checked += 1;
  try {
    decoder.decode(readFileSync(path));
  } catch (error) {
    failures.push({
      path: relative(process.cwd(), path).replaceAll('\\', '/'),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const root of ROOTS) {
  try {
    scan(root);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
}

for (const entry of readdirSync('.')) {
  if (ROOTS.includes(entry) || SKIPPED_DIRECTORIES.has(entry)) continue;
  try {
    const stat = statSync(entry);
    if (stat.isFile() && shouldCheck(entry)) scan(entry);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
}

if (failures.length > 0) {
  console.error('UTF8_INVALID');
  for (const failure of failures) console.error(`${failure.path}: ${failure.error}`);
  process.exitCode = 1;
} else {
  console.log(`UTF8_VALID files=${checked}`);
}
