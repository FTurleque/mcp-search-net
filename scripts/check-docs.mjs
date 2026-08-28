import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const currentStatePath = 'docs/status/current-state.md';
const currentState = readText(currentStatePath);
const clientCertificationPath = 'docs/planning/client-certification-current.md';
const clientCertification = readText(clientCertificationPath);

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
validateAuthenticodePolicyConsistency();

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
      tools: 6,
      productionDefaultTools: 5,
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
  const historyTool = readText('src/presentation/mcp/search-history-tool.ts');
  const resources = readText('src/presentation/mcp/catalog-resources.ts');
  const toolsReference = readText('docs/reference/tools.md');
  const readme = readText('README.md');
  const tools = [
    ['search_web', serverV1],
    ['fetch_url', serverV1],
    ['search_docs', serverV2],
    ['list_docs', serverV2],
    ['read_doc_section', serverV2],
    ['list_search_history', historyTool],
  ];
  requireText(
    clientCertification,
    'six tools',
    `${clientCertificationPath}: inventaire automatisé doit annoncer six tools`,
  );
  requireText(
    toolsReference,
    'history.exposeTool: true',
    'docs/reference/tools.md: caractère opt-in de list_search_history absent',
  );
  for (const [tool, implementation] of tools) {
    requireText(implementation, `'${tool}'`, `outil absent du serveur: ${tool}`);
    requireText(toolsReference, `\`${tool}\``, `docs/reference/tools.md: outil absent ${tool}`);
    requireText(currentState, `\`${tool}\``, `${currentStatePath}: outil absent ${tool}`);
    requireText(readme, `\`${tool}\``, `README.md: outil absent ${tool}`);
    requireText(
      clientCertification,
      `\`${tool}\``,
      `${clientCertificationPath}: outil absent ${tool}`,
    );
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
  const readme = readText('README.md');
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
  const firstMigration = migrations.at(0)?.slice(0, 4);
  const lastMigration = migrations.at(-1)?.slice(0, 4);
  if (firstMigration !== undefined && lastMigration !== undefined) {
    requireText(
      readme,
      `migrations catalogue \`${firstMigration}\` à \`${lastMigration}\``,
      `README.md: plage migrations ${firstMigration}..${lastMigration} absente`,
    );
  }

  const historyMigrations = readdirSync(resolve(root, 'history-migrations'))
    .filter((name) => /^H\d{3}__.+\.sql$/u.test(name))
    .sort();
  for (const migration of historyMigrations) {
    requireText(
      currentState,
      `\`${migration}\``,
      `${currentStatePath}: migration historique absente ${migration}`,
    );
    requireText(readme, `\`${migration}\``, `README.md: migration historique absente ${migration}`);
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
  requireText(
    readText('README.md'),
    `version de code courante est \`${version}\``,
    `README.md: version ${version} absente`,
  );
  requireText(
    readText('sonar-project.properties'),
    `sonar.projectVersion=${version}`,
    'sonar-project.properties: version incohérente',
  );
}

function validateEnvironmentInventory() {
  const environmentSchema = readText('src/infrastructure/config/application-config.ts');
  const readme = readText('README.md');
  const variables = [
    'MCP_CONFIG_PATH',
    'MCP_PROFILE',
    'MCP_LOG_LEVEL',
    'MCP_CACHE_PATH',
    'MCP_CATALOG_PATH',
    'MCP_HISTORY_PATH',
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
    requireText(readme, variable, `README.md: variable absente ${variable}`);
  }
}

function validatePostMergeTruth() {
  const readme = readText('README.md');
  const ci = readText('.github/workflows/ci.yml');
  const windowsGuide = readText('docs/getting-started/installation-windows.md');

  requireText(
    currentState,
    'Intégration V2 : PR #8 mergée',
    `${currentStatePath}: merge PR #8 absent`,
  );
  requireText(
    currentState,
    'Branche de release et source de vérité publiée : `master`',
    `${currentStatePath}: branche de release master absente`,
  );
  requireText(
    currentState,
    'Branche d’intégration courante : `develop`',
    `${currentStatePath}: branche d’intégration develop absente`,
  );
  requireText(
    readme,
    'La V2 documentaire est intégrée dans `master`',
    'README.md: V2 merge absent',
  );

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
  requireText(
    windowsGuide,
    'Inno Setup est figé sur la version 6.7.3',
    'installation-windows.md: Inno Setup 6.7.3 absent',
  );
  requireText(
    windowsGuide,
    'history-migrations\\',
    'installation-windows.md: history-migrations absent de l’arborescence',
  );
  if (
    windowsGuide.includes('Node.js 24.17.0') ||
    windowsGuide.includes('Inno Setup est figé sur la version 6.7.1')
  ) {
    failures.push('installation-windows.md: version runtime ou Inno Setup obsolète');
  }
}

function validateReleaseAndInstallerHardening() {
  const configureInstall = readText('packaging/windows/configure-install.ps1');
  const updateInstallation = readText('packaging/windows/update-installation.ps1');
  const installUser = readText('scripts/install-user.ps1');
  const installationLifecycle = readText('scripts/test-installation.ps1');
  const distributionBuilder = readText('scripts/release/build-windows-distribution.ps1');
  const npmConfig = readText('.npmrc');
  const installedProbe = readText('scripts/probe-installed-mcp.mjs');
  const publisher = readText('scripts/release/publish-windows-release.ps1');
  const releaseWorkflow = readText('.github/workflows/release-windows.yml');
  const nativeCertificationWorkflow = readText(
    '.github/workflows/native-client-certification-record.yml',
  );
  const ci = readText('.github/workflows/ci.yml');
  const dependencyAudit = readText('.github/workflows/dependency-audit.yml');
  const toolCall = readText('src/presentation/mcp/tool-call.ts');

  for (const needle of [
    "ownership    = 'preexisting'",
    "if ($rec.ownership -ne 'managed')",
    'Configuration JSON invalide',
    'ancienne entrée mcpServers non gérée — préservée',
  ]) {
    requireText(
      configureInstall,
      needle,
      `configure-install.ps1: invariant ownership absent: ${needle}`,
    );
  }

  for (const needle of [
    'scripts\\release\\build-windows-distribution.ps1',
    'packaging\\windows\\update-installation.ps1',
    'AllowCustomInstallRoot',
    'MCP_INSTALL_UNSAFE_INSTALL_ROOT',
    'TestFailActivationAfterEntries',
  ]) {
    requireText(
      installUser,
      needle,
      `install-user.ps1: délégation transactionnelle ou garde racine absente: ${needle}`,
    );
  }

  for (const needle of [
    "Join-Path $RepoRoot '.npmrc'",
    "Join-Path $RepoRoot 'history-migrations'",
    'ci --omit=dev --ignore-scripts=false',
  ]) {
    requireText(
      distributionBuilder,
      needle,
      `build-windows-distribution.ps1: payload source incomplet: ${needle}`,
    );
  }
  requireText(
    npmConfig,
    'strict-allow-scripts=true',
    '.npmrc: strict-allow-scripts=true absent du payload de production',
  );

  for (const needle of [
    "Write-TransactionManifest -Phase 'activating'",
    "Write-TransactionManifest -Phase 'committed'",
    'Restore-Transaction',
    'Ensure-OwnershipMarker',
    'TestFailActivationAfterEntries',
  ]) {
    requireText(
      updateInstallation,
      needle,
      `update-installation.ps1: invariant transactionnel absent: ${needle}`,
    );
  }

  for (const needle of [
    'app\\history-migrations',
    '-TestFailActivationAfterEntries 3',
    'app\\rollback.marker',
    'bin\\rollback.marker',
    'runtime\\rollback.marker',
    '.install-rollback',
  ]) {
    requireText(
      installationLifecycle,
      needle,
      `test-installation.ps1: preuve de rollback/packaging absente: ${needle}`,
    );
  }

  for (const needle of [
    "'fetch_url'",
    "'list_docs'",
    "'read_doc_section'",
    "'search_docs'",
    "'search_web'",
    "names.includes('list_search_history')",
    'INSTALLED_HISTORY_TOOL_MUST_BE_OPT_IN',
    'historyExposed: false',
  ]) {
    requireText(
      installedProbe,
      needle,
      `probe-installed-mcp.mjs: contrat privacy production absent: ${needle}`,
    );
  }

  for (const needle of [
    '$Package.version -ne $Version',
    '$PackageLock.version -ne $Version',
    '$PackagedPackage.version -ne $Version',
  ]) {
    requireText(
      publisher,
      needle,
      `publish-windows-release.ps1: invariant version absent: ${needle}`,
    );
  }
  for (const needle of [
    "$innoVersion = '6.7.3'",
    "$innoUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe'",
    "$innoSha256 = '9C73C3BAE7ED48D44112A0F48E66742C00090BDB5BEF71D9D3C056C66E97B732'",
    '.\\scripts\\windows\\verify-file-sha256.ps1', // NOSONAR
    'assert-native-client-certification.ps1',
    'WINDOWS_SIGNING_CERTIFICATE_BASE64',
    'Get-AuthenticodeSignature -FilePath $setup',
    'actions/attest-build-provenance@9d57eef8c06cd9d6b433effeeb7a6a77b3ff94ad',
    'gh attestation verify $artifact --repo $env:GITHUB_REPOSITORY',
  ]) {
    requireText(releaseWorkflow, needle, `release-windows.yml: invariant absent: ${needle}`);
  }
  for (const needle of [
    'nativeToolInvocationObserved',
    'PASS_NATIVE_3_OF_3',
    'native-client-certification-${{ github.sha }}',
  ]) {
    requireText(
      nativeCertificationWorkflow,
      needle,
      `native-client-certification-record.yml: invariant absent: ${needle}`,
    );
  }
  if (releaseWorkflow.includes('choco install innosetup')) {
    failures.push('release-windows.yml: installation Inno mutable via Chocolatey encore présente');
  }
  requireText(
    ci,
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1',
    'ci.yml: download-artifact Node 24 qualifié absent',
  );
  for (const needle of [
    "cron: '17 5 * * *'",
    'npm audit --audit-level=moderate',
    'npm audit --omit=dev --audit-level=moderate',
  ]) {
    requireText(dependencyAudit, needle, `dependency-audit.yml: invariant absent: ${needle}`);
  }
  requireText(
    toolCall,
    'formatExternalContentText(options.formatText(validated))',
    'tool-call.ts: provenance texte externe absente',
  );
  requireText(
    toolCall,
    'PUBLIC_TOOL_ERROR_MESSAGES[error.code]',
    'tool-call.ts: mapping public canonique des erreurs absent',
  );
}

function validateAuthenticodePolicyConsistency() {
  const releaseWorkflow = readText('.github/workflows/release-windows.yml');
  const readme = readText('README.md');
  const docs = [
    ['README.md', readme],
    [currentStatePath, currentState],
    [clientCertificationPath, clientCertification],
  ];

  requireText(
    releaseWorkflow,
    'default: false',
    'release-windows.yml: authenticode input must default to false — docs assume unsigned-by-default policy',
  );

  const CANONICAL_PHRASE = 'Authenticode (optionnelle, désactivée par défaut)';
  const BANNED_PHRASES = ['Authenticode obligatoire', 'exige...une signature Authenticode'];

  for (const [file, text] of docs) {
    const normalized = normalizeProseWhitespace(text);
    requireText(
      normalized,
      CANONICAL_PHRASE,
      `${file}: doit documenter la politique Authenticode optionnelle avec la formulation canonique "${CANONICAL_PHRASE}"`,
    );
    for (const banned of BANNED_PHRASES) {
      assert(
        !normalized.includes(banned),
        `${file}: contradiction Authenticode obligatoire détectée ("${banned}") alors que le workflow la garde optionnelle par défaut`,
      );
    }
  }
}

function normalizeProseWhitespace(text) {
  return text.replace(/\s+/gu, ' ');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
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
