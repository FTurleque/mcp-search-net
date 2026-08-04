[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string] $Version,

    [string] $DistributionRoot = '',
    [string] $OutputRoot = '',

    [switch] $Smoke
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($env:OS -ne 'Windows_NT') {
    throw "L'installateur Windows doit être compilé sur Windows."
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $RepoRoot 'target\dist'
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

$DistributionName = "mcp-search-net-$Version-windows-x64"
if ([string]::IsNullOrWhiteSpace($DistributionRoot)) {
    $DistributionRoot = Join-Path $OutputRoot $DistributionName
}
$DistributionRoot = [System.IO.Path]::GetFullPath($DistributionRoot)

if (-not (Test-Path -LiteralPath $DistributionRoot -PathType Container)) {
    throw "Dossier de distribution introuvable : $DistributionRoot"
}

foreach ($Required in @(
    'app\build\bootstrap\main.js',
    "runtime\node-v24.17.0-win-x64\node.exe",
    'bin\mcp-search-net.cmd',
    'config\application.yml',
    'scripts\configure-install.ps1',
    'install.ps1',
    'BUILD-MANIFEST.json',
    'THIRD-PARTY-NOTICES.txt'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $DistributionRoot $Required))) {
        throw "Distribution invalide pour l'installateur : $Required manquant"
    }
}

$IsccCandidates = @()
$IsccCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($IsccCommand) { $IsccCandidates += $IsccCommand.Source }
if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $IsccCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 7\ISCC.exe')
    $IsccCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
}
foreach ($Pf in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if (-not [string]::IsNullOrWhiteSpace($Pf)) {
        $IsccCandidates += (Join-Path $Pf 'Inno Setup 7\ISCC.exe')
        $IsccCandidates += (Join-Path $Pf 'Inno Setup 6\ISCC.exe')
    }
}
$IsccCandidates += 'C:\ProgramData\chocolatey\bin\ISCC.exe'

$Iscc = $IsccCandidates |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($Iscc)) {
    throw 'Inno Setup est requis. Installez Inno Setup 6/7 ou exposez ISCC.exe dans le PATH.'
}

$Template = Join-Path $RepoRoot 'packaging\windows\mcp-search-net-installer.iss.template'
if (-not (Test-Path -LiteralPath $Template -PathType Leaf)) {
    throw "Template Inno Setup introuvable : $Template"
}

$InstallerWork = Join-Path $OutputRoot '.installer'
$InstallerOutput = if ($Smoke) { Join-Path $OutputRoot '.smoke' } else { $OutputRoot }
$IssName = if ($Smoke) { "$DistributionName-smoke.iss" } else { "$DistributionName.iss" }
$OutputBaseName = if ($Smoke) { "mcp-search-net-$Version-windows-x64-smoke-setup" } else { "mcp-search-net-$Version-windows-x64-setup" }
New-Item -ItemType Directory -Force -Path $InstallerWork, $InstallerOutput | Out-Null

$GeneratedIss = Join-Path $InstallerWork $IssName
$Setup = Join-Path $InstallerOutput "$OutputBaseName.exe"
$Checksum = "$Setup.sha256"
Remove-Item -LiteralPath $Setup -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Checksum -Force -ErrorAction SilentlyContinue

function Escape-InnoString([string] $Value) { return $Value.Replace('"', '""') }

$BaseVersion = ($Version -split '[-+]')[0]
$NumericVersion = "$BaseVersion.0"
$AppId = if ($Smoke) { "mcp-search-net-Release-Smoke-$Version" } else { '{{A3F2C8D1-4B7E-4F9A-8C2D-1E6B0A3F7D5C}' }
$SmokeMode = if ($Smoke) { '1' } else { '0' }

$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Iss = [System.IO.File]::ReadAllText($Template, $Utf8)
$Iss = $Iss.Replace('@@VERSION@@', (Escape-InnoString $Version))
$Iss = $Iss.Replace('@@APP_VERSION@@', (Escape-InnoString $NumericVersion))
$Iss = $Iss.Replace('@@APP_ID@@', (Escape-InnoString $AppId))
$Iss = $Iss.Replace('@@SMOKE_MODE@@', $SmokeMode)
$Iss = $Iss.Replace('@@SOURCE_DIR@@', (Escape-InnoString $DistributionRoot))
$Iss = $Iss.Replace('@@OUTPUT_DIR@@', (Escape-InnoString $InstallerOutput))
$Iss = $Iss.Replace('@@OUTPUT_BASENAME@@', (Escape-InnoString $OutputBaseName))
if ($Iss -match '@@[A-Z0-9_]+@@') {
    throw "Token non résolu dans le template Inno Setup : $($Matches[0])"
}
[System.IO.File]::WriteAllText($GeneratedIss, $Iss, $Utf8)

try {
    & $Iscc $GeneratedIss
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup a échoué (code $LASTEXITCODE)" }
    if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) { throw "Exécutable setup non produit : $Setup" }

    $Hash = (Get-FileHash -LiteralPath $Setup -Algorithm SHA256).Hash.ToLowerInvariant()
    "$Hash  $([System.IO.Path]::GetFileName($Setup))" | Set-Content -LiteralPath $Checksum -Encoding ascii

    $SuccessLabel = if ($Smoke) { 'mcp-search-net smoke setup SUCCESS' } else { 'mcp-search-net setup SUCCESS' }
    Write-Host ''
    Write-Host $SuccessLabel -ForegroundColor Green
    Write-Host "Setup    : $Setup"
    Write-Host "SHA-256  : $Hash"
    Write-Host "Mode     : $(if ($Smoke) { 'smoke' } else { 'production' })"
    Write-Host "Inno     : $Iscc"
}
finally {
    Remove-Item -LiteralPath $GeneratedIss -Force -ErrorAction SilentlyContinue
}
