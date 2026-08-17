[CmdletBinding()]
param(
    [string] $InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch] $AddToPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA est introuvable. Ce programme nécessite un profil utilisateur Windows.'
}
if ($env:OS -ne 'Windows_NT') {
    throw 'Ce programme nécessite Windows x64.'
}

$PackageRoot = Split-Path $MyInvocation.MyCommand.Path -Parent
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$Updater = Join-Path $PackageRoot 'scripts\update-installation.ps1'
if (-not (Test-Path -LiteralPath $Updater -PathType Leaf)) {
    throw "Moteur de mise à jour absent : $Updater"
}

Write-Host "Installation / mise à jour de mcp-search-net dans $InstallRoot"
& $Updater -PackageRoot $PackageRoot -InstallRoot $InstallRoot
if ($LASTEXITCODE -ne 0) { throw "update-installation.ps1 a échoué (code $LASTEXITCODE)." }

& (Join-Path $InstallRoot 'scripts\configure-install.ps1') -InstallRoot $InstallRoot
if ($LASTEXITCODE -ne 0) { throw "configure-install.ps1 a échoué (code $LASTEXITCODE)." }

[System.Environment]::SetEnvironmentVariable('MCP_SEARCH_HOME', $InstallRoot, [System.EnvironmentVariableTarget]::User)
Write-Host "Variable d'environnement MCP_SEARCH_HOME=$InstallRoot (utilisateur)"

if ($AddToPath) {
    $BinPath = Join-Path $InstallRoot 'bin'
    $rawPath = [System.Environment]::GetEnvironmentVariable('Path', [System.EnvironmentVariableTarget]::User)
    $current = if ($null -eq $rawPath) { '' } else { $rawPath }
    $entries = $current -split ';' | Where-Object { $_ -ne '' }
    if ($entries -notcontains $BinPath) {
        $newPath = ($entries + $BinPath) -join ';'
        [System.Environment]::SetEnvironmentVariable('Path', $newPath, [System.EnvironmentVariableTarget]::User)
        Write-Host "PATH utilisateur : $BinPath ajouté"
    }
}

Write-Host ''
Write-Host 'Installation / mise à jour terminée.' -ForegroundColor Green
Write-Host "Lanceur MCP  : $(Join-Path $InstallRoot 'bin\mcp-search-net.cmd')"
Write-Host "Config MCP   : $(Join-Path $InstallRoot 'mcp.json.example')"
Write-Host 'Configuration et données existantes conservées automatiquement.'
Write-Host "Démarrer les fournisseurs Docker avec :"
Write-Host "  cd '$InstallRoot'"
Write-Host '  docker compose up -d searxng crawl4ai'
