import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const license = readText('LICENSE');
const contributing = readText('CONTRIBUTING.md');
const readme = readText('README.md');
const packageJson = JSON.parse(readText('package.json'));
const dockerfile = readText('Dockerfile');
const dockerignore = readText('.dockerignore');
const distribution = readText('scripts/release/build-windows-distribution.ps1');
const installer = readText('scripts/release/build-windows-installer.ps1');

for (const required of [
  'MCP-SEARCH-NET — PROPRIETARY SOURCE-AVAILABLE LICENSE',
  'Copyright (c) 2026 Fabrice Turleque. All rights reserved.',
  "The public availability of the Software's source code does not make the Software",
  'PUBLIC GITHUB HOSTING',
  'NO GENERAL LICENSE GRANT',
  'THIRD-PARTY COMPONENTS',
]) {
  requireText(license, required, `LICENSE_MISSING:${required}`);
}

assert(packageJson.license === 'SEE LICENSE IN LICENSE', 'PACKAGE_LICENSE_NOT_PROPRIETARY');
assert(packageJson.author === 'Fabrice Turleque', 'PACKAGE_AUTHOR_MISMATCH');
assert(packageJson.private === true, 'PACKAGE_MUST_REMAIN_PRIVATE_TO_NPM');

for (const required of [
  'proprietary source-available software',
  'External code contributions are **not accepted by default**',
  '[`LICENSE`](LICENSE)',
]) {
  requireText(contributing, required, `CONTRIBUTING_LICENSE_POLICY_MISSING:${required}`);
}

for (const required of [
  '## Licence',
  'logiciel **propriétaire source-available**',
  '[`LICENSE`](LICENSE)',
]) {
  requireText(readme, required, `README_LICENSE_NOTICE_MISSING:${required}`);
}

requireText(
  dockerfile,
  'org.opencontainers.image.licenses="LicenseRef-mcp-search-net-Proprietary"',
  'OCI_LICENSE_LABEL_MISSING',
);
requireText(
  dockerfile,
  'COPY package.json package-lock.json LICENSE ./',
  'OCI_LICENSE_FILE_MISSING',
);
requireText(dockerignore, '!LICENSE', 'DOCKER_CONTEXT_LICENSE_ALLOWLIST_MISSING');

for (const required of [
  "Copy-Item -LiteralPath (Join-Path $RepoRoot 'LICENSE') -Destination $AppDist -Force",
  "Copy-Item -LiteralPath (Join-Path $RepoRoot 'LICENSE') -Destination $DistRoot -Force",
  'mcp-search-net itself is proprietary software governed by the bundled LICENSE file.',
  'Each third-party package is distributed under its own license.',
]) {
  requireText(distribution, required, `WINDOWS_DISTRIBUTION_LICENSE_MISSING:${required}`);
}

for (const required of [
  "'LICENSE'",
  "if (-not $Iss.Contains('LicenseFile='))",
  'throw "La licence propriétaire n\'est pas présentée par l\'installateur Inno Setup."',
]) {
  requireText(installer, required, `WINDOWS_INSTALLER_LICENSE_MISSING:${required}`);
}

if (failures.length > 0) {
  process.stderr.write(`LICENSE_CHECK_FAILED (${failures.length})\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'LICENSE_CHECK_PASSED',
      model: 'proprietary-source-available',
      copyrightHolder: 'Fabrice Turleque',
      allRightsReserved: true,
      npmPublishingDisabled: packageJson.private === true,
      bundledInWindowsDistribution: true,
      displayedByWindowsInstaller: true,
      bundledInOciImage: true,
      dockerContextIncludesLicense: true,
      thirdPartyLicensesPreserved: true,
    },
    null,
    2,
  )}\n`,
);

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function requireText(source, value, failure) {
  assert(source.includes(value), failure);
}

function assert(condition, failure) {
  if (!condition) failures.push(failure);
}
