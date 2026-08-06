import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const packageJson = readJson('package.json');
const compose = readText('compose.yaml');
const ci = readText('.github/workflows/ci.yml');
const releaseWorkflow = readText('.github/workflows/release-windows.yml');
const dockerfile = readText('Dockerfile');
const security = readText('docs/reference/security.md');
const installerBuilder = readText('scripts/release/build-windows-installer.ps1');
const runtimeGuard = readText('scripts/check-node-version.mjs');
const repositoryFacade = readText('src/infrastructure/catalog/sqlite-catalog-repository.ts');
const revisionWriter = readText('src/infrastructure/catalog/sqlite-catalog-revision-writer.ts');
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

const expectedNodeImage =
  'node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d';
assert(
  dockerfile.split('\n').filter((line) => line.startsWith(`FROM ${expectedNodeImage} AS `))
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
requireText(ci, 'test "$crawl4ai_network_count" = \'1\'', 'CI: gate réseau Crawl4AI = 1 absent');
requireText(
  security,
  'Crawl4AI reste uniquement sur le réseau interne `backend`',
  'Documentation sécurité: isolation Crawl4AI absente',
);

assert(
  readText('.npmrc')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes('strict-allow-scripts=true'),
  '.npmrc: strict-allow-scripts=true absent',
);
const expectedAllowScripts = {
  'better-sqlite3@12.11.1': true,
  'esbuild@0.28.1': true,
  'fsevents@2.3.3': true,
};
assert(
  JSON.stringify(packageJson.allowScripts) === JSON.stringify(expectedAllowScripts),
  'package.json: allowScripts inattendu',
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
  '.VersionInfo.ProductVersion',
  "StartsWith('6.7.1'",
]) {
  requireText(releaseWorkflow, needle, `release-windows: invariant Inno absent: ${needle}`);
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
requireText(
  readText('docs/adr/ADR-018-local-embeddings-evaluation.md'),
  "l'intégration runtime reste `NON`",
  'ADR-018: interdiction adoption runtime avant prototype absente',
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
      installScriptAllowlist: Object.keys(expectedAllowScripts),
      catalogComponents: 5,
      benchmarkQueries: querySet.queries.length,
      paraphraseQueries: categories.get('paraphrase') ?? 0,
      multiDocumentQueries: categories.get('multi-document') ?? 0,
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
