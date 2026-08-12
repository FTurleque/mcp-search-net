import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const nodeModulesRoot = resolve(root, 'node_modules');
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const npmrc = readText('.npmrc');
const dockerfile = readText('Dockerfile');
const dockerignore = readText('.dockerignore');
const windowsDistributionBuilder = readText('scripts/release/build-windows-distribution.ps1');
const windowsReleaseWorkflow = readText('.github/workflows/release-windows.yml');
const compose = readText('compose.yaml');
const composeHybrid = readText('compose.hybrid.yaml');

const expected = {
  sdk: '1.30.0',
  betterSqlite3: '13.0.3',
  nodeDockerImage:
    'node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d',
  nodeRelayImage:
    'node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d',
  innoSetup: {
    version: '6.7.1',
    url: 'https://files.jrsoftware.org/is/6/innosetup-6.7.1.exe',
    sha256:
      '4D11E8050B6185E0D49BD9E8CC661A7A59F44959A621D31D11033124C4E8A7B0',
  },
  allowScripts: {
    'better-sqlite3@13.0.3': false,
    'esbuild@0.28.1': true,
    'fsevents@2.3.3': true,
  },
  overrides: {
    '@hono/node-server': '2.1.0',
    'fast-uri': '3.1.5',
    hono: '4.12.34',
  },
  developmentOverrides: {
    'brace-expansion': '5.0.9',
    postcss: '8.5.25',
  },
};

assert(packageJson.dependencies?.['@modelcontextprotocol/sdk'] === expected.sdk, 'SDK_NOT_PINNED');
assert(
  packageLock.packages?.['node_modules/@modelcontextprotocol/sdk']?.version === expected.sdk,
  'SDK_LOCK_MISMATCH',
);
assert(
  packageJson.dependencies?.['better-sqlite3'] === expected.betterSqlite3,
  'BETTER_SQLITE3_NOT_PINNED',
);
const lockedBetterSqlite3 = packageLock.packages?.['node_modules/better-sqlite3'];
assert(lockedBetterSqlite3?.version === expected.betterSqlite3, 'BETTER_SQLITE3_LOCK_MISMATCH');
assert(
  packageLock.packages?.['node_modules/node-addon-api'] !== undefined,
  'BETTER_SQLITE3_NAPI_DEPENDENCY_MISSING',
);
assert(
  packageLock.packages?.['node_modules/prebuild-install'] === undefined,
  'DEPRECATED_PREBUILD_INSTALL_PRESENT',
);
assert(
  packageLock.packages?.['node_modules/bindings'] === undefined,
  'LEGACY_BINDINGS_PACKAGE_PRESENT',
);
assert(
  JSON.stringify(packageJson.allowScripts) === JSON.stringify(expected.allowScripts),
  'INSTALL_SCRIPT_ALLOWLIST_MISMATCH',
);
assert(
  npmrc
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes('strict-allow-scripts=true'),
  'STRICT_ALLOW_SCRIPTS_NOT_ENABLED',
);
assert(
  dockerfile.split('COPY .npmrc ./').length - 1 === 2,
  'STRICT_ALLOW_SCRIPTS_NOT_PROPAGATED_TO_DOCKER',
);
assert(
  dockerignore
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes('!.npmrc'),
  'STRICT_ALLOW_SCRIPTS_NOT_AVAILABLE_IN_DOCKER_CONTEXT',
);
assert(
  windowsDistributionBuilder.includes(
    "Copy-Item -LiteralPath (Join-Path $RepoRoot '.npmrc') -Destination $AppDist -Force",
  ),
  'STRICT_ALLOW_SCRIPTS_NOT_PROPAGATED_TO_WINDOWS_STAGING',
);
for (const [name, version] of Object.entries(expected.overrides)) {
  assert(packageJson.overrides?.[name] === version, `OVERRIDE_NOT_PINNED:${name}`);
  assert(
    packageLock.packages?.[`node_modules/${name}`]?.version === version,
    `LOCK_MISMATCH:${name}`,
  );
}
for (const [selector, version] of Object.entries(expected.developmentOverrides)) {
  assert(packageJson.overrides?.[selector] === version, `DEV_OVERRIDE_NOT_PINNED:${selector}`);
  assert(
    packageLock.packages?.[`node_modules/${selector}`]?.version === version,
    `DEV_LOCK_MISMATCH:${selector}`,
  );
}

const nodeImageLines = dockerfile
  .split(/\r?\n/u)
  .filter((line) => line.startsWith(`FROM ${expected.nodeDockerImage} AS `));
assert(nodeImageLines.length === 2, 'NODE_IMAGE_DIGEST_NOT_PINNED_IN_BOTH_STAGES');

const relayImageLines = composeHybrid
  .split(/\r?\n/u)
  .filter((line) => line.trim() === `image: ${expected.nodeRelayImage}`);
assert(relayImageLines.length === 1, 'LOOPBACK_RELAY_IMAGE_DIGEST_NOT_PINNED');

const providerImageLines = compose
  .split(/\r?\n/u)
  .filter((line) =>
    /^\s*image:\s*(?:docker\.io\/searxng\/searxng|unclecode\/crawl4ai)@sha256:[a-f0-9]{64}\s*$/u.test(
      line,
    ),
  );
assert(providerImageLines.length === 2, 'PROVIDER_IMAGE_DIGEST_NOT_PINNED');
assert(!/\$\{SEARXNG_SECRET:-/u.test(compose), 'COMPOSE_DEFAULT_SECRET_PRESENT');
assert(!/\$\{CRAWL4AI_API_TOKEN:-/u.test(compose), 'COMPOSE_DEFAULT_TOKEN_PRESENT');

for (const needle of [
  `$innoVersion = '${expected.innoSetup.version}'`,
  `$innoUrl = '${expected.innoSetup.url}'`,
  `$innoSha256 = '${expected.innoSetup.sha256}'`,
  '.\\scripts\\windows\\verify-file-sha256.ps1',
]) {
  assert(windowsReleaseWorkflow.includes(needle), `INNO_SETUP_PIN_MISSING:${needle}`);
}
assert(
  !windowsReleaseWorkflow.includes('choco install innosetup'),
  'INNO_SETUP_MUTABLE_CHOCO_INSTALL_PRESENT',
);
const innoVerification = windowsReleaseWorkflow.indexOf(
  '.\\scripts\\windows\\verify-file-sha256.ps1',
);
const innoExecution = windowsReleaseWorkflow.indexOf(
  'Start-Process',
  innoVerification + 1,
);
assert(
  innoVerification >= 0 && innoExecution > innoVerification,
  'INNO_SETUP_NOT_VERIFIED_BEFORE_EXECUTION',
);

const allowedLicenses = new Set([
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  '(MIT OR WTFPL)',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
]);
const licenseCounts = new Map();
let installedProductionPackages = 0;
for (const [packagePath, lockEntry] of Object.entries(packageLock.packages ?? {})) {
  if (packagePath.length === 0 || lockEntry.dev === true) continue;
  const manifestPath = resolve(root, packagePath, 'package.json');
  assertPathInsideNodeModules(manifestPath, packagePath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (lockEntry.optional === true) continue;
    throw new Error(`PRODUCTION_PACKAGE_NOT_INSTALLED:${packagePath}`, { cause: error });
  }
  const license = normalizeLicense(manifest);
  assert(allowedLicenses.has(license), `UNAPPROVED_OR_MISSING_LICENSE:${manifest.name}:${license}`);
  installedProductionPackages += 1;
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'SUPPLY_CHAIN_CHECK_PASSED',
      sdk: expected.sdk,
      betterSqlite3: expected.betterSqlite3,
      betterSqlite3Napi: true,
      betterSqlite3FallbackBuildAllowed: false,
      deprecatedPrebuildInstallPresent: false,
      installScriptAllowlist: expected.allowScripts,
      strictAllowScripts: true,
      strictAllowScriptsPropagatedToDocker: true,
      strictAllowScriptsAvailableInDockerContext: true,
      strictAllowScriptsPropagatedToWindowsStaging: true,
      overrides: expected.overrides,
      developmentOverrides: expected.developmentOverrides,
      dockerImageReferencesPinnedByDigest: 5,
      innoSetup: expected.innoSetup,
      innoSetupVerifiedBeforeExecution: true,
      installedProductionPackages,
      licenses: Object.fromEntries(
        [...licenseCounts].sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    null,
    2,
  )}\n`,
);

function assertPathInsideNodeModules(path, packagePath) {
  const relativePath = relative(nodeModulesRoot, path);
  assert(
    relativePath.length > 0 &&
      !isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    `PACKAGE_PATH_OUTSIDE_NODE_MODULES:${packagePath}`,
  );
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function normalizeLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry.type).join(' OR ');
  }
  return 'MISSING';
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
