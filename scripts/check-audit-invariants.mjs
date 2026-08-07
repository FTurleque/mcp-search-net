import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const compose = readText('compose.yaml');
const composeHybrid = readText('compose.hybrid.yaml');
const ci = readText('.github/workflows/ci.yml');
const releaseWorkflow = readText('.github/workflows/release-windows.yml');
const dockerfile = readText('Dockerfile');
const security = readText('docs/reference/security.md');
const currentState = readText('docs/status/current-state.md');
const adr018 = readText('docs/adr/ADR-018-local-embeddings-evaluation.md');
const installerBuilder = readText('scripts/release/build-windows-installer.ps1');
const installerTemplate = readText('packaging/windows/mcp-search-net-installer.iss.template');
const configureInstall = readText('packaging/windows/configure-install.ps1');
const runtimeGuard = readText('scripts/check-node-version.mjs');
const repositoryFacade = readText('src/infrastructure/catalog/sqlite-catalog-repository.ts');
const revisionWriter = readText('src/infrastructure/catalog/sqlite-catalog-revision-writer.ts');
const sourceLoader = readText('src/application/use-cases/load-catalog-sources.ts');
const syncDocuments = readText('src/application/use-cases/sync-catalog-documents.ts');
const ingestText = readText('src/cli/catalog-ingest-text.ts');
const versionPurger = readText('src/infrastructure/catalog/sqlite-catalog-version-purger.ts');
const secureHttpGateway = readText('src/infrastructure/fetch/secure-http-gateway.ts');
const fetchUrl = readText('src/application/use-cases/fetch-url.ts');
const httpUtils = readText('src/infrastructure/http/http-utils.ts');
const clientReporter = readText('scripts/generate-client-contract-report.mjs');
const querySet = readJson('benchmarks/v2-search-quality/queries.json');

const expectedNode = '24.18.0';
assert(readText('.nvmrc').trim() === expectedNode, '.nvmrc: Node 24.18.0 attendu');
assert(readText('.node-version').trim() === expectedNode, '.node-version: Node 24.18.0 attendu');
requireText(
  runtimeGuard,
  `requiredVersion = '${expectedNode}'`,
  'check-node-version: version exacte absente',
);

const expectedNodeDockerImage =
  'node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d';
const expectedNodeRelayImage =
  'node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d';
assert(
  dockerfile.split('\n').filter((line) => line.startsWith(`FROM ${expectedNodeDockerImage} AS `))
    .length === 2,
  'Dockerfile: image Node 24.18.0 figée attendue dans les deux stages',
);
assert(
  countOccurrences(ci, 'node-version: 24.18.0') === 3,
  'CI: trois runtimes Node 24.18.0 attendus',
);
requireText(
  releaseWorkflow,
  'node-version: 24.18.0',
  'release-windows: runtime Node 24.18.0 absent',
);

const crawl4aiBlock = serviceBlock(compose, 'crawl4ai', 'mcp-search-net');
requireText(crawl4aiBlock, '- backend', 'Compose: Crawl4AI doit rester sur backend');
assert(!crawl4aiBlock.includes('- egress'), 'Compose: Crawl4AI ne doit pas rejoindre egress');
assert(
  !crawl4aiBlock.includes('ports:'),
  'Compose: Crawl4AI ne doit publier aucun port directement',
);
requireText(ci, 'test "$crawl4ai_network_count" = \'1\'', 'CI: gate réseau Crawl4AI = 1 absent');
requireText(ci, 'test -z "$crawl4ai_port"', 'CI: absence de port direct Crawl4AI non contrôlée');
requireText(
  security,
  'Crawl4AI reste uniquement sur le réseau interne `backend`',
  'Documentation sécurité: isolation Crawl4AI absente',
);

const relayBlock = serviceBlock(composeHybrid, 'crawl4ai-loopback', 'searxng');
requireText(
  relayBlock,
  `image: ${expectedNodeRelayImage}`,
  'Overlay hybride: image relais Node figée absente',
);
requireText(relayBlock, 'user: node', 'Overlay hybride: utilisateur node du relais absent');
requireText(relayBlock, "host: 'crawl4ai'", 'Overlay hybride: destination Crawl4AI fixe absente');
requireText(relayBlock, '- backend', 'Overlay hybride: relais absent de backend');
requireText(relayBlock, '- egress', 'Overlay hybride: relais absent de egress');
requireText(
  relayBlock,
  "- '127.0.0.1:11235:11235'",
  'Overlay hybride: publication loopback absente',
);
requireText(relayBlock, 'read_only: true', 'Overlay hybride: relais read-only absent');
requireText(relayBlock, '- ALL', 'Overlay hybride: cap_drop du relais absent');
requireText(
  relayBlock,
  '- no-new-privileges:true',
  'Overlay hybride: no-new-privileges du relais absent',
);
requireText(
  ci,
  'test "$relay_network_count" = \'2\'',
  'CI: gate réseau du relais Crawl4AI = 2 absent',
);
requireText(
  ci,
  'test "$relay_port" = \'127.0.0.1:11235\'',
  'CI: gate port loopback du relais absent',
);
requireText(
  security,
  'relais TCP Node minimal',
  'Documentation sécurité: relais loopback Crawl4AI absent',
);

assert(
  readText('.npmrc')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes('strict-allow-scripts=true'),
  '.npmrc: strict-allow-scripts=true absent',
);
const expectedAllowScripts = {
  'esbuild@0.28.1': true,
  'fsevents@2.3.3': true,
};
assert(
  JSON.stringify(packageJson.allowScripts) === JSON.stringify(expectedAllowScripts),
  'package.json: allowScripts inattendu',
);
assert(
  packageJson.dependencies?.['better-sqlite3'] === '13.0.3',
  'package.json: better-sqlite3 13.0.3 attendu',
);
assert(
  packageLock.packages?.['node_modules/better-sqlite3']?.version === '13.0.3',
  'package-lock: better-sqlite3 13.0.3 attendu',
);
assert(
  packageLock.packages?.['node_modules/better-sqlite3']?.hasInstallScript !== true,
  'package-lock: better-sqlite3 ne doit plus avoir de script install',
);
assert(
  packageLock.packages?.['node_modules/node-addon-api'] !== undefined,
  'package-lock: node-addon-api attendu pour better-sqlite3 N-API',
);
assert(
  packageLock.packages?.['node_modules/prebuild-install'] === undefined,
  'package-lock: prebuild-install déprécié doit être absent',
);

for (const needle of [
  "$ExpectedInnoVersion = '6.7.1'",
  '.VersionInfo.ProductVersion',
  'Version Inno Setup non qualifiée',
]) {
  requireText(
    installerBuilder,
    needle,
    `build-windows-installer: invariant Inno absent: ${needle}`,
  );
}
for (const needle of [
  'choco install innosetup --version=6.7.1',
  '--require-checksums',
  '.VersionInfo.ProductVersion',
  "StartsWith('6.7.1'",
]) {
  requireText(releaseWorkflow, needle, `release-windows: invariant Inno absent: ${needle}`);
}

for (const invariant of [
  'actions: read',
  'head_sha=$env:GITHUB_SHA',
  'CI_EXACT_HEAD_QUALIFIED',
  'Node.js 24 validation',
  'Docker integration and live E2E',
  'Windows installation and STDIO packaging',
]) {
  requireText(
    releaseWorkflow,
    invariant,
    `release-windows: gate CI exact-head absent: ${invariant}`,
  );
}

for (const invariant of [
  'DeleteUserDataOnUninstall := False',
  "if DeleteUserDataOnUninstall and DirExists(ExpandConstant('{app}')) then",
  'Silent uninstall therefore preserves them.',
]) {
  requireText(
    installerTemplate,
    invariant,
    `installer Inno: conservation des données utilisateur absente: ${invariant}`,
  );
}
assert(
  !installerTemplate.includes(
    "if DirExists(ExpandConstant('{localappdata}\\mcp-search-net')) then",
  ),
  'installer Inno: suppression non prouvée du répertoire ZIP historique encore présente',
);

for (const invariant of [
  'function Test-CodexMcpEntry',
  'elseif (Test-CodexMcpEntry $text)',
  "table 'mcp_servers.mcp-search-net' existante non gérée — préservée",
  "ownership    = 'preexisting'",
]) {
  requireText(
    configureInstall,
    invariant,
    `configuration Codex: ownership préexistant non protégé: ${invariant}`,
  );
}

for (const component of [
  'SqliteCatalogSourceStore',
  'SqliteCatalogReadModel',
  'SqliteCatalogRevisionWriter',
  'SqliteCatalogSearch',
  'SqliteCatalogSyncStore',
]) {
  requireText(repositoryFacade, component, `catalog facade: composant absent ${component}`);
}
for (const invariant of [
  'this.database.transaction',
  'DELETE_DOCUMENT_SECTION_FTS_BY_DOCUMENT_SQL',
  'INSERT_DOCUMENT_VERSION_SECTIONS_FTS_SQL',
  'SET_DOCUMENT_CURRENT_VERSION_SQL',
  'this.syncStore.persistObservation',
]) {
  requireText(revisionWriter, invariant, `revision writer: invariant atomique absent ${invariant}`);
}
for (const invariant of [
  'MAX_PERSISTED_SECTION_CHARACTERS = 12_000',
  'SECTION_CHUNK_OVERLAP_CHARACTERS = 400',
  'chunkDocumentSections(revision.sections)',
  'seenContentHashes',
]) {
  requireText(repositoryFacade, invariant, `catalog facade: chunking borné absent ${invariant}`);
}
for (const invariant of [
  "CatalogSourceLoadStatus = 'created' | 'updated' | 'skipped'",
  'repository.updateSource(source)',
  'await this.repository.rebuildSearchIndex()',
]) {
  requireText(sourceLoader, invariant, `catalog sources: réconciliation absente ${invariant}`);
}
for (const invariant of [
  'WebUrl.createTransport(document.url)',
  'const continuationCursor = limited ? cursorFor(selectedDocuments.at(-1)) : options.resumeAfter',
  'resumeAfter: continuationCursor',
]) {
  requireText(
    syncDocuments,
    invariant,
    `catalog sync: invariant reprise/transport absent ${invariant}`,
  );
}
for (const invariant of [
  'MAX_INGEST_TEXT_BYTES = 16 * 1024 * 1024',
  'await stat(options.filePath)',
  'WebUrl.createTransport(options.canonicalUrl)',
]) {
  requireText(ingestText, invariant, `catalog ingest: borne locale absente ${invariant}`);
}
for (const invariant of [
  'SQLITE_ID_BATCH_SIZE = 400',
  'for (const batch of chunkIds(versionIds))',
]) {
  requireText(versionPurger, invariant, `catalog purge: traitement par lots absent ${invariant}`);
}

for (const invariant of [
  'DEFAULT_MAX_TRACKED_ORIGINS = 1_024',
  'readonly maxTrackedOrigins?: number',
  'this.rememberOriginRequest(origin, Date.now())',
  'while (this.lastRequestByOrigin.size > this.maxTrackedOrigins)',
  'const absoluteTimer = setTimeout(() => {',
  'budget.remainingBytes -= chunk.length',
  'if (isRedirectStatus(status) || status === 304)',
]) {
  requireText(
    secureHttpGateway,
    invariant,
    `secure HTTP gateway: invariant de budget absent: ${invariant}`,
  );
}
for (const invariant of [
  'WebUrl.createTransport(request.url)',
  'JSON.stringify({ url: approved.value, renderMode: request.renderMode, contractVersion: 4 })',
  'MIN_LINK_INSPECTION_BUDGET = 32',
  'MAX_LINK_VALIDATION_MS = 2_000',
  'inspected >= maximumInspections',
]) {
  requireText(fetchUrl, invariant, `fetch_url: transport/cache/liens non bornés ${invariant}`);
}
for (const invariant of [
  'DEFAULT_MAX_PROVIDER_JSON_BYTES = 16 * 1024 * 1024',
  'readJsonWithLimit',
  'total > maximumBytes',
]) {
  requireText(httpUtils, invariant, `provider JSON: borne absente ${invariant}`);
}

assert(
  packageJson.scripts?.['client:contract-report'] ===
    'node scripts/generate-client-contract-report.mjs',
  'package.json: client:contract-report absent',
);
requireText(
  packageJson.scripts?.check ?? '',
  'npm run client:contract-report',
  'package.json: rapport client absent du gate check',
);
for (const contractInvariant of [
  'EXPECTED_TOOLS',
  'EXPECTED_RESOURCES',
  'EXPECTED_TEMPLATES',
  "structuredContent?.schemaVersion !== '1.0'",
  'nativeThirdPartyClientCertification: false',
]) {
  requireText(
    clientReporter,
    contractInvariant,
    `client contract report: invariant absent ${contractInvariant}`,
  );
}

assert(
  Array.isArray(querySet.queries) && querySet.queries.length >= 60,
  'benchmark V2: au moins 60 requêtes attendues',
);
const categories = new Map();
for (const query of querySet.queries ?? []) {
  categories.set(query.category, (categories.get(query.category) ?? 0) + 1);
}
assert((categories.get('paraphrase') ?? 0) >= 10, 'benchmark V2: 10 paraphrases minimum attendues');
assert(
  (categories.get('multi-document') ?? 0) >= 10,
  'benchmark V2: 10 requêtes multi-document minimum attendues',
);
for (const invariant of [
  '**Statut** : Accepté',
  "l'intégration runtime reste `NON`",
  'recommendation: prototype-local-vector-index',
  'adoptEmbeddingRuntimeNow: false',
  '31124100736',
]) {
  requireText(adr018, invariant, `ADR-018: décision embeddings non réconciliée: ${invariant}`);
}
for (const invariant of [
  'Hardening post-audit complet : PR #37 mergée',
  '31126841127',
  'prototype-local-vector-index',
  'adoptEmbeddingRuntimeNow: false',
]) {
  requireText(
    currentState,
    invariant,
    `current-state: état post-audit non réconcilié: ${invariant}`,
  );
}
assert(
  !existsSync(resolve(root, '.github/workflows/local-embeddings-benchmark.yml')),
  'CI: workflow embeddings one-shot terminé encore présent',
);
assert(
  !existsSync(resolve(root, '.github/workflows/bootstrap-better-sqlite3-lock.yml')),
  'CI: workflow bootstrap better-sqlite3 temporaire encore présent',
);

if (failures.length > 0) {
  process.stderr.write(`AUDIT_INVARIANTS_FAILED (${failures.length})\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'AUDIT_INVARIANTS_PASSED',
      node: expectedNode,
      crawl4aiNetworks: ['backend'],
      crawl4aiLoopbackRelay: true,
      installScriptAllowlist: Object.keys(expectedAllowScripts),
      betterSqlite3: '13.0.3',
      betterSqlite3Napi: true,
      deprecatedPrebuildInstallPresent: false,
      catalogComponents: 5,
      benchmarkQueries: querySet.queries.length,
      paraphraseQueries: categories.get('paraphrase') ?? 0,
      multiDocumentQueries: categories.get('multi-document') ?? 0,
      embeddingsDecision: 'prototype-local-vector-index',
      adoptEmbeddingRuntimeNow: false,
      oneShotBenchmarkWorkflowRemoved: true,
      temporarySqliteBootstrapWorkflowRemoved: true,
      boundedOriginThrottle: true,
      absoluteHttpDeadline: true,
      boundedLinkValidation: true,
      boundedProviderJson: true,
      boundedCatalogSections: true,
      reconciledCatalogSources: true,
      safeWindowsUninstall: true,
      exactHeadReleaseGate: true,
      codexOwnershipProtection: true,
      clientContractReport: true,
    },
    null,
    2,
  )}\n`,
);

function serviceBlock(source, startService, nextService) {
  const start = source.indexOf(`  ${startService}:`);
  const end = source.indexOf(`  ${nextService}:`, start + 1);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function requireText(source, needle, failure) {
  assert(source.includes(needle), failure);
}

function assert(condition, failure) {
  if (!condition) failures.push(failure);
}
