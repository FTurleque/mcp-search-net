import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const currentStatePath = 'docs/status/current-state.md';
const currentState = readText(currentStatePath);

const markdownFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  ...walkMarkdown('docs'),
  ...walkMarkdown('.github'),
];

for (const file of markdownFiles) validateMarkdownLinks(file);
validateNpmScriptReferences();
validateAdrIndex();
validateDocumentationIndex();
validatePublicContractInventory();
validateMigrationInventory();
validateVersionConsistency();
validateEnvironmentInventory();
validatePostMergeTruth();
validateReleaseAndInstallerHardening();

if (failures.length > 0) {
  process.stderr.write(`DOCS_CHECK_FAILED (${failures.length})\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'DOCS_CHECK_PASSED',
      markdownFiles: markdownFiles.length,
      tools: 5,
      resources: 4,
      resourceTemplates: 9,
      migrations: readdirSync(resolve(root, 'catalog-migrations')).filter((name) =>
        /^C\d{3}__.+\.sql$/u.test(name),
      ).length,
      version: packageJson.version,
    },
    null,
    2,
  )}\n`,
);

function validateMarkdownLinks(file) {
  const source = stripFencedCode(readText(file));
  const links = source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu);
  for (const match of links) {
    const rawTarget = (match[1] ?? '').trim();
    const target = linkDestination(rawTarget);
    if (
      target === '' ||
      /^(?:https?:|mailto:|app:|mcp-search-net:)/iu.test(target) ||
      target.startsWith('::')
    ) {
      continue;
    }

    const [rawPath = '', rawFragment] = target.split('#', 2);
    const decodedPath = decodeURIComponent(rawPath);
    const targetFile =
      decodedPath === '' ? resolve(root, file) : resolve(root, dirname(file), decodedPath);
    if (!isInsideRoot(targetFile)) {
      failures.push(`${file}: link escapes repository: ${target}`);
      continue;
    }
    if (!existsSync(targetFile)) {
      failures.push(`${file}: missing link target: ${target}`);
      continue;
    }
    if (
      statSync(targetFile).isFile() &&
      rawFragment !== undefined &&
      extname(targetFile).toLowerCase() === '.md'
    ) {
      const fragment = decodeURIComponent(rawFragment).toLowerCase();
      if (fragment !== '' && !markdownAnchors(readFileSync(targetFile, 'utf8')).has(fragment)) {
        failures.push(`${file}: missing anchor #${rawFragment} in ${display(targetFile)}`);
      }
    }
  }
}

function validateNpmScriptReferences() {
  const currentDocs = markdownFiles.filter((file) => !file.startsWith('docs/planning/'));
  for (const file of currentDocs) {
    for (const match of readText(file).matchAll(/npm run ([a-zA-Z0-9:_-]+)/gu)) {
      const script = match[1];
      if (script !== undefined && packageJson.scripts?.[script] === undefined) {
        failures.push(`${file}: unknown npm script ${script}`);
      }
    }
  }
}

function validateAdrIndex() {
  const index = readText('docs/adr/README.md');
  const adrFiles = readdirSync(resolve(root, 'docs/adr'))
    .filter((name) => /^ADR-\d{3}-.+\.md$/u.test(name))
    .sort();
  for (const adr of adrFiles) requireText(index, adr, `docs/adr/README.md: ADR absent ${adr}`);
}

function validateDocumentationIndex() {
  const index = readText('docs/README.md');
  const required = [
    'status/current-state.md',
    'getting-started/catalog-token-budget.md',
    'reference/catalog-semantic-search-v2.md',
    'operations/install-user-lock.md',
    'development/local-git-hooks.md',
    'adr/ADR-017-search-quality-strategy-v2.md',
  ];
  for (const path of required) requireText(index, path, `docs/README.md: entrée absente ${path}`);
}

function validatePublicContractInventory() {
  const serverV1 = readText('src/presentation/mcp/mcp-server.ts');
  const serverV2 = readText('src/presentation/mcp/mcp-server-v2.ts');
  const resources = readText('src/presentation/mcp/catalog-resources.ts');
  const toolsReference = readText('docs/reference/tools.md');
  const tools = ['search_web', 'fetch_url', 'search_docs', 'list_docs', 'read_doc_section'];
  for (const tool of tools) {
    const implementation = tool === 'search_web' || tool === 'fetch_url' ? serverV1 : serverV2;
    requireText(implementation, `'${tool}'`, `outil absent du serveur: ${tool}`);
    requireText(toolsReference, `\`${tool}\``, `docs/reference/tools.md: outil absent ${tool}`);
    requireText(currentState, `\`${tool}\``, `${currentStatePath}: outil absent ${tool}`);
  }
  for (const option of ['maxSnippetChars', 'compact']) {
    requireText(
      toolsReference,
      `\`${option}\``,
      `docs/reference/tools.md: option search_docs absente ${option}`,
    );
  }

  const resourceUris = [
    'mcp-search-net://catalog',
    'mcp-search-net://sources',
    'mcp-search-net://documents',
    'mcp-search-net://sections',
    'mcp-search-net://sources/page/{offset}',
    'mcp-search-net://sources/{sourceId}',
    'mcp-search-net://documents/page/{offset}',
    'mcp-search-net://documents/{documentId}',
    'mcp-search-net://documents/{documentId}/versions',
    'mcp-search-net://documents/{documentId}/versions/page/{offset}',
    'mcp-search-net://documents/{documentId}/versions/{versionId}',
    'mcp-search-net://sections/page/{offset}',
    'mcp-search-net://sections/{sectionId}',
  ];
  for (const uri of resourceUris) {
    requireText(resources, `'${uri}'`, `resource absente du serveur: ${uri}`);
    requireText(currentState, `\`${uri}\``, `${currentStatePath}: resource absente ${uri}`);
  }
}

function validateMigrationInventory() {
  const migrations = readdirSync(resolve(root, 'catalog-migrations'))
    .filter((name) => /^C\d{3}__.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    requireText(
      currentState,
      `\`${migration}\``,
      `${currentStatePath}: migration absente ${migration}`,
    );
  }
}

function validateVersionConsistency() {
  const version = packageJson.version;
  if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
    failures.push('package.json/package-lock.json: version incohérente');
  }
  for (const config of [
    'config/application.yml',
    'config/application.user.yml',
    'config/application.docker.yml',
  ]) {
    requireText(readText(config), `version: ${version}`, `${config}: version ${version} absente`);
  }
  requireText(
    readText('compose.yaml'),
    `mcp-search-net:${version}`,
    'compose.yaml: tag image incohérent',
  );
  requireText(
    readText('src/infrastructure/config/application-config.ts'),
    `version: '${version}'`,
    'application-config.ts: version par défaut incohérente',
  );
  requireText(
    currentState,
    `Version SemVer : \`${version}\``,
    `${currentStatePath}: version incohérente`,
  );
}

function validateEnvironmentInventory() {
  const environmentSchema = readText('src/infrastructure/config/application-config.ts');
  const variables = [
    'MCP_CONFIG_PATH',
    'MCP_PROFILE',
    'MCP_LOG_LEVEL',
    'MCP_CACHE_PATH',
    'MCP_CATALOG_PATH',
    'MCP_OFFICIAL_SOURCES_PATH',
    'MCP_SEARXNG_URL',
    'MCP_CRAWL4AI_URL',
    'MCP_CRAWL4AI_TOKEN',
    'MCP_ALLOWED_PUBLIC_PORTS',
  ];
  for (const variable of variables) {
    requireText(environmentSchema, variable, `schéma environnement: variable absente ${variable}`);
    requireText(
      currentState,
      `\`${variable}\``,
      `${currentStatePath}: variable absente ${variable}`,
    );
  }
}

function validatePostMergeTruth() {
  const readme = readText('README.md');
  const ci = readText('.github/workflows/ci.yml');
  const windowsGuide = readText('docs/getting-started/installation-windows.md');

  requireText(currentState, 'Intégration V2 : PR #8 mergée', `${currentStatePath}: merge PR #8 absent`);
  requireText(currentState, 'Branche de référence : `master`', `${currentStatePath}: master absent`);
  requireText(readme, 'La V2 documentaire est intégrée dans `master`', 'README.md: V2 merge absent');

  for (const stale of [
    'La PR #8 ajoute',
    'Fonctionnalités en cours de stabilisation dans la PR #8',
    'SHA candidat V2 : `de769ee',
  ]) {
    if (readme.includes(stale) || currentState.includes(stale)) {
      failures.push(`documentation courante: formulation V2 obsolète détectée: ${stale}`);
    }
  }

  if (ci.includes('feat/v2-catalog-storage')) {
    failures.push('.github/workflows/ci.yml: branche V2 intégration obsolète encore ciblée');
  }
  requireText(windowsGuide, 'Node.js 24.18.0', 'installation-windows.md: runtime 24.18.0 absent');
  if (windowsGuide.includes('Node.js 24.17.0')) {
    failures.push('installation-windows.md: runtime 24.17.0 obsolète');
  }
}

function validateReleaseAndInstallerHardening() {
  const configureInstall = readText('packaging/windows/configure-install.ps1');
  const publisher = readText('scripts/release/publish-windows-release.ps1');
  const releaseWorkflow = readText('.github/workflows/release-windows.yml');
  const toolCall = readText('src/presentation/mcp/tool-call.ts');

  for (const needle of [
    "ownership    = 'preexisting'",
    "if ($rec.ownership -ne 'managed')",
    'Configuration JSON invalide',
    'ancienne entrée mcpServers non gérée — préservée',
  ]) {
    requireText(configureInstall, needle, `configure-install.ps1: invariant ownership absent: ${needle}`);
  }

  for (const needle of [
    '$Package.version -ne $Version',
    '$PackageLock.version -ne $Version',
    '$PackagedPackage.version -ne $Version',
  ]) {
    requireText(publisher, needle, `publish-windows-release.ps1: invariant version absent: ${needle}`);
  }
  requireText(
    releaseWorkflow,
    'choco install innosetup --version=6.7.1',
    'release-windows.yml: Inno Setup non figé en 6.7.1',
  );
  requireText(
    toolCall,
    'formatExternalContentText(options.formatText(validated))',
    'tool-call.ts: provenance texte externe absente',
  );
}

function markdownAnchors(source) {
  const anchors = new Set();
  const counts = new Map();
  for (const match of stripFencedCode(source).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const base = githubSlug(match[1] ?? '');
    if (base === '') continue;
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

function githubSlug(value) {
  return value
    .replace(/<[^>]+>/gu, '')
    .replace(/[`*_~]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/gu, '-');
}

function stripFencedCode(source) {
  return source.replace(/^```[\s\S]*?^```\s*$/gmu, '');
}

function linkDestination(rawTarget) {
  if (rawTarget.startsWith('<')) {
    const end = rawTarget.indexOf('>');
    return end === -1 ? rawTarget : rawTarget.slice(1, end);
  }
  return rawTarget.split(/\s+["']/u, 1)[0] ?? '';
}

function walkMarkdown(directory) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(absolute, entry.name);
    const displayed = display(path);
    if (entry.isDirectory()) return walkMarkdown(displayed);
    return entry.isFile() && entry.name.endsWith('.md') ? [displayed] : [];
  });
}

function isInsideRoot(path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

function requireText(source, needle, failure) {
  if (!source.includes(needle)) failures.push(failure);
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function display(path) {
  return relative(root, path).split(sep).join('/');
}
