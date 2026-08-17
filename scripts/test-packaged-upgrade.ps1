[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Cette recette doit être exécutée sur Windows.'
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Updater = Join-Path $RepoRoot 'packaging\windows\update-installation.ps1'
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mcp-search-net-packaged-upgrade-" + [guid]::NewGuid().ToString('N'))
$InstallRoot = Join-Path $TestRoot 'installed with spaces'

function New-FixturePackage {
    param(
        [Parameter(Mandatory)] [string] $Root,
        [Parameter(Mandatory)] [string] $Version,
        [Parameter(Mandatory)] [string] $Revision
    )

    foreach ($dir in @(
        'app\build\bootstrap',
        'bin',
        'runtime\node-v24.18.0-win-x64',
        'scripts',
        'docker',
        'config\searxng'
    )) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Root $dir) | Out-Null
    }

    Set-Content -LiteralPath (Join-Path $Root 'app\build\bootstrap\main.js') -Value "main-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'app\version.txt') -Value $Version
    Set-Content -LiteralPath (Join-Path $Root 'bin\mcp-search-net.cmd') -Value "@echo $Version"
    Set-Content -LiteralPath (Join-Path $Root 'runtime\node-v24.18.0-win-x64\node.exe') -Value "node-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'scripts\configure-install.ps1') -Value "Write-Host configure-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'scripts\update-installation.ps1') -Value "Write-Host updater-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'docker\compose.yaml') -Value "# compose-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'docker\compose.hybrid.yaml') -Value "# hybrid-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'docker\.dockerignore') -Value "data-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'config\application.yml') -Value "application-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'config\application.docker.yml') -Value "docker-config-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'config\official-sources.yml') -Value "sources-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'config\searxng\settings.yml') -Value "searxng-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'LICENSE') -Value "license-$Version"
    Set-Content -LiteralPath (Join-Path $Root 'THIRD-PARTY-NOTICES.txt') -Value "notices-$Version"
    [ordered]@{
        schemaVersion = '1.0'
        name = 'mcp-search-net'
        version = $Version
        nodeVersion = '24.18.0'
        sourceRevision = $Revision
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root 'BUILD-MANIFEST.json') -Encoding UTF8
}

function Assert-Contains {
    param([string] $Path, [string] $Expected)
    if (-not (Select-String -LiteralPath $Path -SimpleMatch $Expected -Quiet)) {
        throw "Valeur attendue '$Expected' absente de $Path"
    }
}

try {
    $PackageV1 = Join-Path $TestRoot 'package-v1'
    $PackageV2 = Join-Path $TestRoot 'package-v2'
    $PackageV3 = Join-Path $TestRoot 'package-v3'
    New-FixturePackage -Root $PackageV1 -Version '1.0.0' -Revision ('1' * 40)
    New-FixturePackage -Root $PackageV2 -Version '1.1.0' -Revision ('2' * 40)
    New-FixturePackage -Root $PackageV3 -Version '1.2.0' -Revision ('3' * 40)
    Set-Content -LiteralPath (Join-Path $PackageV1 'app\obsolete.txt') -Value 'must-disappear-on-upgrade'
    Set-Content -LiteralPath (Join-Path $PackageV2 'app\new.txt') -Value 'new-v2'
    Set-Content -LiteralPath (Join-Path $PackageV3 'app\new.txt') -Value 'new-v3'

    & $Updater -PackageRoot $PackageV1 -InstallRoot $InstallRoot -SkipProcessStop
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.0.0'

    Add-Content -LiteralPath (Join-Path $InstallRoot 'config\application.yml') -Value 'user-application-setting'
    Add-Content -LiteralPath (Join-Path $InstallRoot 'config\application.docker.yml') -Value 'user-docker-setting'
    Add-Content -LiteralPath (Join-Path $InstallRoot 'config\official-sources.yml') -Value 'user-sources-setting'
    Add-Content -LiteralPath (Join-Path $InstallRoot 'config\searxng\settings.yml') -Value 'user-searxng-setting'
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'data') | Out-Null
    Set-Content -LiteralPath (Join-Path $InstallRoot 'data\preserve.marker') -Value 'user-data'
    Set-Content -LiteralPath (Join-Path $InstallRoot '.env') -Value 'SECRET=preserve-me'
    Set-Content -LiteralPath (Join-Path $InstallRoot 'mcp-client-integrations.json') -Value '{"managed":"preserve-me"}'

    & $Updater -PackageRoot $PackageV2 -InstallRoot $InstallRoot -SkipProcessStop
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.1.0'
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'app\obsolete.txt')) {
        throw 'La mise à jour a laissé un fichier programme obsolète.'
    }
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v2'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml') 'user-application-setting'
    Assert-Contains (Join-Path $InstallRoot 'config\application.docker.yml') 'user-docker-setting'
    Assert-Contains (Join-Path $InstallRoot 'config\official-sources.yml') 'user-sources-setting'
    Assert-Contains (Join-Path $InstallRoot 'config\searxng\settings.yml') 'user-searxng-setting'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml.default') 'application-1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'config\application.docker.yml.default') 'docker-config-1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'config\official-sources.yml.default') 'sources-1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'config\searxng\settings.yml.default') 'searxng-1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'data\preserve.marker') 'user-data'
    Assert-Contains (Join-Path $InstallRoot '.env') 'preserve-me'
    Assert-Contains (Join-Path $InstallRoot 'mcp-client-integrations.json') 'preserve-me'

    $rollbackObserved = $false
    try {
        & $Updater `
            -PackageRoot $PackageV3 `
            -InstallRoot $InstallRoot `
            -SkipProcessStop `
            -TestFailActivationAfterEntries 4
    }
    catch {
        $rollbackObserved = $true
        if ($_.Exception.Message -notmatch 'MCP_UPDATE_TEST_ACTIVATION_FAILURE') {
            throw
        }
    }
    if (-not $rollbackObserved) { throw "Le fault injection de rollback n'a pas échoué comme attendu." }

    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v2'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml') 'user-application-setting'
    Assert-Contains (Join-Path $InstallRoot 'data\preserve.marker') 'user-data'
    if (Test-Path -LiteralPath (Join-Path $InstallRoot '.install-staging')) {
        throw 'Le rollback a laissé le staging.'
    }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot '.install-rollback')) {
        throw 'Le rollback a laissé son répertoire de transaction.'
    }

    & $Updater -PackageRoot $PackageV3 -InstallRoot $InstallRoot -SkipProcessStop
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.2.0'
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v3'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml') 'user-application-setting'
    Assert-Contains (Join-Path $InstallRoot 'data\preserve.marker') 'user-data'

    Write-Host 'PACKAGED_IN_PLACE_UPGRADE_VALID'
}
finally {
    if (Test-Path -LiteralPath $TestRoot) {
        Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
