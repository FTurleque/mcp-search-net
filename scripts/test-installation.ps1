[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$NodeRuntimeSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mcp-search-net-install-" + [guid]::NewGuid().ToString('N'))
$OriginalLocalAppData = $env:LOCALAPPDATA
$env:LOCALAPPDATA = Join-Path $TestRoot 'LocalAppData'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'mcp-search-net'
$RuntimeRoot = Join-Path $InstallRoot 'runtime\node-v24.17.0-win-x64'

try {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Copy-Item -Path (Join-Path $NodeRuntimeSource '*') -Destination $RuntimeRoot -Recurse -Force

    & (Join-Path $RepositoryRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks

    $ConfigPath = Join-Path $InstallRoot 'config\application.yml'
    $DataMarker = Join-Path $InstallRoot 'data\preserve.marker'
    Add-Content -LiteralPath $ConfigPath -Value "`n# preserved-user-configuration"
    Set-Content -LiteralPath $DataMarker -Value 'preserved-user-data'

    & (Join-Path $RepositoryRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks
    if (-not (Select-String -LiteralPath $ConfigPath -SimpleMatch 'preserved-user-configuration')) {
        throw 'La réinstallation a remplacé la configuration utilisateur.'
    }
    if (-not (Test-Path -LiteralPath $DataMarker)) {
        throw 'La réinstallation a supprimé les données utilisateur.'
    }

    & (Join-Path $RepositoryRoot 'scripts\uninstall-user.ps1') -InstallRoot $InstallRoot -KeepData -SkipServices -Confirm:$false
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'config')) -or -not (Test-Path -LiteralPath $DataMarker)) {
        throw 'La désinstallation -KeepData n’a pas conservé configuration et données.'
    }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'app')) {
        throw 'La désinstallation -KeepData n’a pas supprimé le programme.'
    }

    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Copy-Item -Path (Join-Path $NodeRuntimeSource '*') -Destination $RuntimeRoot -Recurse -Force
    & (Join-Path $RepositoryRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks
    & (Join-Path $RepositoryRoot 'scripts\uninstall-user.ps1') -InstallRoot $InstallRoot -SkipServices -Confirm:$false
    if (Test-Path -LiteralPath $InstallRoot) {
        throw 'La désinstallation complète a laissé le dossier utilisateur.'
    }

    Write-Host 'INSTALLATION_LIFECYCLE_VALID'
}
finally {
    $env:LOCALAPPDATA = $OriginalLocalAppData
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTestRoot.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
