[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string] $Version,

    [Parameter(Mandatory)]
    [string] $NodeZipPath,

    [string] $CommitSha = '',
    [string] $OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($env:OS -ne 'Windows_NT') {
    throw 'La distribution Windows doit être construite sur Windows.'
}
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
    throw "Racine du dépôt introuvable : $RepoRoot"
}
if (-not (Test-Path -LiteralPath $NodeZipPath -PathType Leaf)) {
    throw "Archive Node.js introuvable : $NodeZipPath"
}

$NodeVersion = '24.18.0'
$NodeFolderName = "node-v$NodeVersion-win-x64"
$NodeArchiveSha256 = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'

$ActualSha256 = (Get-FileHash -LiteralPath $NodeZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $NodeArchiveSha256) {
    throw "SHA-256 de l'archive Node.js incorrect : attendu=$NodeArchiveSha256 obtenu=$ActualSha256"
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $RepoRoot 'target\dist'
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

$DistributionName = "mcp-search-net-$Version-windows-x64"
$DistRoot = Join-Path $OutputRoot $DistributionName
New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null

if ([string]::IsNullOrWhiteSpace($CommitSha)) {
    $Git = Get-Command git -ErrorAction SilentlyContinue
    if ($null -ne $Git) {
        $CommitSha = ((& $Git.Source -C $RepoRoot rev-parse HEAD 2>$null) | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $CommitSha -notmatch '^[a-f0-9]{40}$') { $CommitSha = 'UNAVAILABLE' }
    } else { $CommitSha = 'UNAVAILABLE' }
}

Write-Host "Construction de la distribution $DistributionName (commit $CommitSha)..."

$NodeExe = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
$NpmCmd = Get-Command npm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
if (-not $NodeExe -or -not $NpmCmd) { throw 'Node.js et npm sont requis dans le PATH pour construire la distribution.' }

Push-Location $RepoRoot
try {
    Write-Host 'npm ci...'
    & $NpmCmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci a échoué (code $LASTEXITCODE)" }

    Write-Host 'npm run build...'
    & $NpmCmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build a échoué (code $LASTEXITCODE)" }
}
finally { Pop-Location }

$AppDist = Join-Path $DistRoot 'app'
New-Item -ItemType Directory -Force -Path $AppDist | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot 'build') -Destination $AppDist -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'migrations') -Destination $AppDist -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'catalog-migrations') -Destination $AppDist -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'history-migrations') -Destination $AppDist -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'package.json') -Destination $AppDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'package-lock.json') -Destination $AppDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot '.npmrc') -Destination $AppDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'LICENSE') -Destination $AppDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'scripts\probe-installed-mcp.mjs') -Destination $AppDist -Force

Write-Host 'Installation des dépendances de production...'
Push-Location $AppDist
try {
    & $NpmCmd ci --omit=dev --ignore-scripts=false
    if ($LASTEXITCODE -ne 0) { throw "npm ci --omit=dev a échoué (code $LASTEXITCODE)" }
}
finally { Pop-Location }

$ConfigDist = Join-Path $DistRoot 'config'
$SearxDist = Join-Path $ConfigDist 'searxng'
New-Item -ItemType Directory -Force -Path $ConfigDist, $SearxDist | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\application.user.yml') -Destination (Join-Path $ConfigDist 'application.yml') -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\application.user.yml') -Destination (Join-Path $ConfigDist 'application.yml.default') -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\application.docker.yml') -Destination $ConfigDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\application.docker.yml') -Destination (Join-Path $ConfigDist 'application.docker.yml.default') -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\official-sources.yml') -Destination $ConfigDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\official-sources.yml') -Destination (Join-Path $ConfigDist 'official-sources.yml.default') -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\searxng\settings.yml') -Destination $SearxDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'config\searxng\settings.yml') -Destination (Join-Path $SearxDist 'settings.yml.default') -Force

$BinDist = Join-Path $DistRoot 'bin'
New-Item -ItemType Directory -Force -Path $BinDist | Out-Null
foreach ($cmd in @('mcp-search-net.cmd','mcp-search-net-catalog.cmd','mcp-search-net-container.cmd','mcp-search-net-maintain.cmd','mcp-search-net-services.cmd')) {
    Copy-Item -LiteralPath (Join-Path $RepoRoot "scripts\windows\$cmd") -Destination $BinDist -Force
}

$DockerDist = Join-Path $DistRoot 'docker'
New-Item -ItemType Directory -Force -Path $DockerDist | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot 'compose.yaml') -Destination $DockerDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'compose.hybrid.yaml') -Destination $DockerDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'Dockerfile') -Destination $DockerDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot '.dockerignore') -Destination $DockerDist -Force

$ScriptsDist = Join-Path $DistRoot 'scripts'
New-Item -ItemType Directory -Force -Path $ScriptsDist | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot 'packaging\windows\configure-install.ps1') -Destination $ScriptsDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'packaging\windows\detect-integrations.ps1') -Destination $ScriptsDist -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'packaging\windows\update-installation.ps1') -Destination $ScriptsDist -Force

Copy-Item -LiteralPath (Join-Path $RepoRoot 'packaging\windows\install.ps1') -Destination $DistRoot -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'LICENSE') -Destination $DistRoot -Force

$RuntimeDist = Join-Path $DistRoot 'runtime'
New-Item -ItemType Directory -Force -Path $RuntimeDist | Out-Null
Write-Host "Extraction du runtime Node.js $NodeVersion..."
Expand-Archive -LiteralPath $NodeZipPath -DestinationPath $RuntimeDist -Force

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$BuildManifest = [ordered]@{
    schemaVersion  = '1.0'
    name           = 'mcp-search-net'
    version        = $Version
    nodeVersion    = $NodeVersion
    sourceRevision = $CommitSha
    buildDate      = (Get-Date).ToUniversalTime().ToString('o')
}
[System.IO.File]::WriteAllText(
    (Join-Path $DistRoot 'BUILD-MANIFEST.json'),
    (($BuildManifest | ConvertTo-Json -Depth 3) + "`r`n"),
    $Utf8NoBom
)

$NoticesScript = @'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
const lines = [
  `THIRD-PARTY NOTICES - mcp-search-net ${pkg.version}`,
  '='.repeat(60),
  'mcp-search-net itself is proprietary software governed by the bundled LICENSE file.',
  'This distribution also includes the following third-party open source packages.',
  'Each third-party package is distributed under its own license.',
  ''
];
for (const dep of deps.sort()) {
  try {
    const d = JSON.parse(readFileSync(join('node_modules', dep, 'package.json'), 'utf8'));
    lines.push(`${dep}@${d.version}`);
    if (d.license) lines.push(`  License: ${d.license}`);
    const r = d.repository;
    if (r) {
      const url = typeof r === 'string' ? r : (r.url ?? '');
      if (url) lines.push(`  Repository: ${url.replace(/^git\+/, '').replace(/\.git$/, '')}`);
    }
    lines.push('');
  } catch {}
}
writeFileSync('THIRD-PARTY-NOTICES.txt', lines.join('\n'), 'utf8');
'@

$TmpNoticesScript = Join-Path $OutputRoot '.notices-gen.mjs'
[System.IO.File]::WriteAllText($TmpNoticesScript, $NoticesScript, $Utf8NoBom)
try {
    Push-Location $RepoRoot
    try {
        & $NodeExe $TmpNoticesScript
        if ($LASTEXITCODE -ne 0) { throw "Génération THIRD-PARTY-NOTICES.txt a échoué (code $LASTEXITCODE)" }
    }
    finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'THIRD-PARTY-NOTICES.txt') -Destination $DistRoot -Force
}
finally {
    Remove-Item -LiteralPath $TmpNoticesScript -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $RepoRoot 'THIRD-PARTY-NOTICES.txt') -Force -ErrorAction SilentlyContinue
}

$Zip = Join-Path $OutputRoot "$DistributionName.zip"
$ZipChecksum = "$Zip.sha256"
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ZipChecksum -Force -ErrorAction SilentlyContinue

Write-Host "Création du ZIP $Zip..."
Compress-Archive -LiteralPath $DistRoot -DestinationPath $Zip -CompressionLevel Optimal -Force

$ZipHash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$ZipHash  $([System.IO.Path]::GetFileName($Zip))" | Set-Content -LiteralPath $ZipChecksum -Encoding ascii

Write-Host ''
Write-Host 'Distribution Windows SUCCESS' -ForegroundColor Green
Write-Host "Distribution : $DistRoot"
Write-Host "ZIP          : $Zip"
Write-Host "SHA-256      : $ZipHash"
Write-Host "Version      : $Version"
Write-Host "Commit       : $CommitSha"
