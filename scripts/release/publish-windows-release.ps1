[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string] $Version,

    [Parameter(Mandatory)]
    [string] $NodeZipPath,

    [string] $TargetCommit = '',
    [string] $IsccPath = '',

    [switch] $SkipBuild,
    [switch] $ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($env:OS -ne 'Windows_NT') {
    throw 'La publication Windows doit être exécutée sur Windows.'
}
if ([string]::IsNullOrWhiteSpace($IsccPath)) {
    throw 'La publication Windows exige -IsccPath vers le binaire Inno Setup 6.7.3 déjà vérifié.'
}
$IsccPath = [System.IO.Path]::GetFullPath($IsccPath)
if (-not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
    throw "ISCC.exe qualifié introuvable : $IsccPath"
}

function Invoke-NativeChecked {
    param([string]$File, [string[]]$Arguments, [string]$Failure)
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $File @Arguments; $exit = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prev }
    if ($exit -ne 0) { throw "$Failure (exit=$exit)" }
}

function Invoke-ProcessChecked {
    param([string]$File, [string[]]$Arguments, [string]$Failure)
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "$Failure (exit=$($p.ExitCode))" }
}

function Invoke-PowerShellScriptChecked {
    param([string]$Script, [hashtable]$Parameters, [string]$Failure)
    try { & $Script @Parameters }
    catch { throw "${Failure}: $($_.Exception.Message)" }
}

function Verify-Sha256([string]$Artifact, [string]$Checksum) {
    if (-not (Test-Path -LiteralPath $Artifact -PathType Leaf)) { throw "Artefact release manquant : $Artifact" }
    if (-not (Test-Path -LiteralPath $Checksum -PathType Leaf)) { throw "Checksum release manquant : $Checksum" }
    $expected = ((Get-Content -LiteralPath $Checksum | Select-Object -First 1) -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($expected) -or $expected.ToLowerInvariant() -ne $actual) {
        throw "Checksum incorrect pour $Artifact : attendu=$expected obtenu=$actual"
    }
    return $actual
}

$PackageJsonPath = Join-Path $RepoRoot 'package.json'
$PackageLockPath = Join-Path $RepoRoot 'package-lock.json'
$Package = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
$PackageLock = Get-Content -LiteralPath $PackageLockPath -Raw | ConvertFrom-Json -AsHashtable
if ($Package.version -ne $Version) {
    throw "Version de release incohérente : paramètre=$Version package.json=$($Package.version). Mettez à jour la version du dépôt avant de publier."
}
if ($PackageLock.version -ne $Version -or $PackageLock.packages[''].version -ne $Version) {
    throw "Version package-lock.json incohérente avec la release $Version."
}

$Git = Get-Command git -ErrorAction SilentlyContinue
if (-not $Git) { throw 'git est requis pour publier une release.' }
$Head = ((& $Git.Source -C $RepoRoot rev-parse HEAD) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Head)) { throw 'Impossible de résoudre HEAD.' }
$Dirty = @(& $Git.Source -C $RepoRoot status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Impossible d''inspecter le worktree.' }
if ($Dirty.Count -gt 0) { throw "La publication exige un worktree propre. Entrées non engagées:`n$($Dirty -join "`n")" }
if ([string]::IsNullOrWhiteSpace($TargetCommit)) { $TargetCommit = $Head }
if ($TargetCommit -ne $Head) { throw "Le commit cible doit correspondre à HEAD. HEAD=$Head cible=$TargetCommit" }

$Gh = $null
$Repository = ''
if (-not $ValidateOnly) {
    $Gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $Gh) { throw 'GitHub CLI (gh) est requis pour publier la release.' }
    Invoke-NativeChecked -File $Gh.Source -Arguments @('auth','status') -Failure 'GitHub CLI non authentifié'
    $Repository = $env:GITHUB_REPOSITORY
    if ([string]::IsNullOrWhiteSpace($Repository)) {
        $repoJson = (& $Gh.Source repo view --json nameWithOwner | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Impossible de résoudre le dépôt GitHub.' }
        $Repository = ($repoJson | ConvertFrom-Json).nameWithOwner
    }
}

$BuildDistribution = Join-Path $RepoRoot 'scripts\release\build-windows-distribution.ps1'
$BuildInstaller = Join-Path $RepoRoot 'scripts\release\build-windows-installer.ps1'
if (-not $SkipBuild) {
    Invoke-PowerShellScriptChecked -Script $BuildDistribution `
        -Parameters @{ Version=$Version; NodeZipPath=$NodeZipPath; CommitSha=$TargetCommit } `
        -Failure 'Construction de la distribution Windows échouée'
    Invoke-PowerShellScriptChecked -Script $BuildInstaller `
        -Parameters @{ Version=$Version; IsccPath=$IsccPath } `
        -Failure 'Construction du setup Windows échouée'
}
Invoke-PowerShellScriptChecked -Script $BuildInstaller `
    -Parameters @{ Version=$Version; Smoke=$true; IsccPath=$IsccPath } `
    -Failure 'Construction du smoke setup Windows échouée'

$DistName = "mcp-search-net-$Version-windows-x64"
$OutputRoot = Join-Path $RepoRoot 'target\dist'
$Zip = Join-Path $OutputRoot "$DistName.zip"
$ZipChecksum = "$Zip.sha256"
$Setup = Join-Path $OutputRoot "mcp-search-net-$Version-windows-x64-setup.exe"
$SetupChecksum = "$Setup.sha256"
$SmokeSetup = Join-Path $OutputRoot ".smoke\mcp-search-net-$Version-windows-x64-smoke-setup.exe"
$Notices = Join-Path $OutputRoot "THIRD-PARTY-NOTICES-$Version.txt"
$DistRoot = Join-Path $OutputRoot $DistName

if (-not (Test-Path -LiteralPath $Notices -PathType Leaf)) {
    Copy-Item -LiteralPath (Join-Path $DistRoot 'THIRD-PARTY-NOTICES.txt') -Destination $Notices -Force
}
$NoticesChecksum = "$Notices.sha256"
$NoticesHash = (Get-FileHash -LiteralPath $Notices -Algorithm SHA256).Hash.ToLowerInvariant()
"$NoticesHash  $([System.IO.Path]::GetFileName($Notices))" | Set-Content -LiteralPath $NoticesChecksum -Encoding ascii

$ZipHash = Verify-Sha256 $Zip $ZipChecksum
$SetupHash = Verify-Sha256 $Setup $SetupChecksum
if (-not (Test-Path -LiteralPath $SmokeSetup -PathType Leaf)) { throw "Smoke setup manquant : $SmokeSetup" }

$NodeExe = Join-Path $DistRoot "runtime\node-v24.18.0-win-x64\node.exe"

$ZipSmokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("msn-release-zip-" + [Guid]::NewGuid())
$ZipExtract = Join-Path $ZipSmokeRoot 'package'
$ZipInstallRoot = Join-Path $ZipSmokeRoot 'installed'
try {
    New-Item -ItemType Directory -Force -Path $ZipExtract | Out-Null
    Expand-Archive -LiteralPath $Zip -DestinationPath $ZipExtract -Force
    $PackagedRoot = Join-Path $ZipExtract $DistName
    $PackagedInstaller = Join-Path $PackagedRoot 'install.ps1'
    if (-not (Test-Path -LiteralPath $PackagedInstaller -PathType Leaf)) { throw "Installateur portable manquant dans ZIP : $PackagedInstaller" }
    $ManifestFile = Join-Path $PackagedRoot 'BUILD-MANIFEST.json'
    if (-not (Test-Path -LiteralPath $ManifestFile -PathType Leaf)) { throw "BUILD-MANIFEST.json manquant dans ZIP" }
    $Manifest = Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
    if ($Manifest.version -ne $Version) { throw "Version ZIP incorrecte : attendu=$Version obtenu=$($Manifest.version)" }
    if ($Manifest.sourceRevision -ne $TargetCommit) { throw "Révision ZIP incorrecte : attendu=$TargetCommit obtenu=$($Manifest.sourceRevision)" }
    $PackagedPackage = Get-Content -LiteralPath (Join-Path $PackagedRoot 'app\package.json') -Raw | ConvertFrom-Json
    if ($PackagedPackage.version -ne $Version) {
        throw "Version package.json embarquée incorrecte : attendu=$Version obtenu=$($PackagedPackage.version)"
    }

    Invoke-PowerShellScriptChecked -Script $PackagedInstaller `
        -Parameters @{ InstallRoot=$ZipInstallRoot } `
        -Failure 'Installateur portable ZIP échoué'

    foreach ($req in @('app\build\bootstrap\main.js', 'bin\mcp-search-net.cmd', 'config\application.yml', '.env')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ZipInstallRoot $req))) {
            throw "Fichier requis absent après installation portable : $req"
        }
    }

    $ProbeScript = Join-Path $ZipInstallRoot 'app\probe-installed-mcp.mjs'
    $ZipNodeExe = Join-Path $ZipInstallRoot "runtime\node-v24.18.0-win-x64\node.exe"
    Invoke-NativeChecked -File $ZipNodeExe `
        -Arguments @($ProbeScript, (Join-Path $ZipInstallRoot 'bin\mcp-search-net.cmd'), $ZipInstallRoot) `
        -Failure 'Sonde MCP STDIO (ZIP) échouée'
    Write-Host 'Sonde MCP STDIO ZIP : PASS'
}
finally { Remove-Item -LiteralPath $ZipSmokeRoot -Recurse -Force -ErrorAction SilentlyContinue }

$SetupSmokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("msn-release-setup-" + [Guid]::NewGuid())
$SetupInstallRoot = Join-Path $SetupSmokeRoot 'installed with spaces'
$SetupInstalled = $false
$SetupUninstalled = $false
try {
    New-Item -ItemType Directory -Force -Path $SetupSmokeRoot | Out-Null
    Invoke-ProcessChecked -File $SmokeSetup `
        -Arguments @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="{0}"' -f $SetupInstallRoot),'/TASKS="!addtopath"') `
        -Failure 'Installation silencieuse du smoke setup échouée'
    $SetupInstalled = $true

    foreach ($req in @('app\build\bootstrap\main.js', 'bin\mcp-search-net.cmd', 'config\application.yml', '.env')) {
        if (-not (Test-Path -LiteralPath (Join-Path $SetupInstallRoot $req))) {
            throw "Fichier requis absent après installation setup smoke : $req"
        }
    }

    $ProbeScript = Join-Path $SetupInstallRoot 'app\probe-installed-mcp.mjs'
    $SetupNodeExe = Join-Path $SetupInstallRoot "runtime\node-v24.18.0-win-x64\node.exe"
    Invoke-NativeChecked -File $SetupNodeExe `
        -Arguments @($ProbeScript, (Join-Path $SetupInstallRoot 'bin\mcp-search-net.cmd'), $SetupInstallRoot) `
        -Failure 'Sonde MCP STDIO (setup smoke) échouée'
    Write-Host 'Sonde MCP STDIO setup smoke : PASS'

    $Uninstaller = Get-ChildItem -LiteralPath $SetupInstallRoot -File -Filter 'unins*.exe' |
        Sort-Object Name | Select-Object -First 1 -ExpandProperty FullName
    if ([string]::IsNullOrWhiteSpace($Uninstaller)) { throw "Désinstallateur absent de $SetupInstallRoot" }
    Invoke-ProcessChecked -File $Uninstaller `
        -Arguments @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') `
        -Failure 'Désinstallation silencieuse du smoke setup échouée'
    $SetupUninstalled = $true
    if (Test-Path -LiteralPath $SetupInstallRoot) { throw "Le smoke setup a laissé le dossier programme après désinstallation : $SetupInstallRoot" }
}
finally {
    if ($SetupInstalled -and -not $SetupUninstalled) {
        try {
            $Rollback = Get-ChildItem -LiteralPath $SetupInstallRoot -File -Filter 'unins*.exe' -ErrorAction SilentlyContinue |
                Sort-Object Name | Select-Object -First 1 -ExpandProperty FullName
            if ($Rollback) { Invoke-ProcessChecked -File $Rollback -Arguments @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Failure 'Rollback smoke setup échoué' }
        } catch { Write-Warning "Rollback smoke setup : $($_.Exception.Message)" }
    }
    Remove-Item -LiteralPath $SetupSmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $OutputRoot '.smoke') -Recurse -Force -ErrorAction SilentlyContinue
}

if ($ValidateOnly) {
    Write-Host ''
    Write-Host 'mcp-search-net Windows release VALIDATION SUCCESS' -ForegroundColor Green
    Write-Host "Commit       : $TargetCommit"
    Write-Host "Setup        : $Setup"
    Write-Host "Setup SHA-256: $SetupHash"
    Write-Host "ZIP          : $Zip"
    Write-Host "ZIP SHA-256  : $ZipHash"
    Write-Host "MCP STDIO    : PASS (ZIP + smoke setup)"
    Write-Host "Notices SHA  : $NoticesHash"
    return
}

$Tag = "v$Version"
$prev2 = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$probeOut = ((& $Gh.Source release view $Tag --repo $Repository 2>&1) | Out-String).Trim()
$probeExit = $LASTEXITCODE
$ErrorActionPreference = $prev2
if ($probeExit -eq 0) { throw "GitHub Release $Tag existe déjà. Les releases sont immuables ; publiez une nouvelle version." }
if ($probeOut -notmatch '(?i)release not found') { throw "Impossible de vérifier GitHub Release $Tag (exit=$probeExit): $probeOut" }

$ExistingTag = @(& $Git.Source -C $RepoRoot ls-remote --tags origin "refs/tags/$Tag")
if ($LASTEXITCODE -ne 0) { throw "Impossible de vérifier le tag $Tag sur origin." }
if ($ExistingTag.Count -gt 0) { throw "Le tag $Tag existe déjà sur origin sans release associée. Résolvez ce tag explicitement." }

$ReleaseArgs = @(
    'release','create',$Tag,$Setup,$SetupChecksum,$Zip,$ZipChecksum,$Notices,$NoticesChecksum,
    '--repo',$Repository,'--target',$TargetCommit,'--title',"mcp-search-net $Version",'--generate-notes'
)
if ($Version -match '-') { $ReleaseArgs += '--prerelease' }
Invoke-NativeChecked -File $Gh.Source -Arguments $ReleaseArgs -Failure "Publication GitHub Release $Tag échouée"

Write-Host ''
Write-Host 'mcp-search-net GitHub Release SUCCESS' -ForegroundColor Green
Write-Host "Repository   : $Repository"
Write-Host "Tag          : $Tag"
Write-Host "Commit       : $TargetCommit"
Write-Host "Setup SHA-256: $SetupHash"
Write-Host "ZIP SHA-256  : $ZipHash"
Write-Host "MCP STDIO    : PASS (ZIP + smoke setup)"
Write-Host "Notices SHA  : $NoticesHash"
