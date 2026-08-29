[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string] $Version,

    [string] $DistributionRoot = '',
    [string] $OutputRoot = '',
    [string] $IsccPath = '',

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
$PayloadZip = Join-Path $OutputRoot "$DistributionName.zip"

if (-not (Test-Path -LiteralPath $DistributionRoot -PathType Container)) {
    throw "Dossier de distribution introuvable : $DistributionRoot"
}
if (-not (Test-Path -LiteralPath $PayloadZip -PathType Leaf)) {
    throw "ZIP de distribution introuvable pour le setup : $PayloadZip"
}

foreach ($Required in @(
    'app\build\bootstrap\main.js',
    "runtime\node-v24.18.0-win-x64\node.exe",
    'bin\mcp-search-net.cmd',
    'config\application.yml',
    'scripts\configure-install.ps1',
    'scripts\update-installation.ps1',
    'scripts\mcp-search-net-global-policy.md',
    'install.ps1',
    'BUILD-MANIFEST.json',
    'LICENSE',
    'THIRD-PARTY-NOTICES.txt'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $DistributionRoot $Required))) {
        throw "Distribution invalide pour l'installateur : $Required manquant"
    }
}

# A production installer is a release candidate: it must pass the same Windows
# transactional qualification that protects in-place upgrades. Smoke builds are
# exempt because the dedicated workflow already runs these gates before building
# its smoke setup, and publish-windows-release.ps1 always builds production first.
if (-not $Smoke) {
    $Npx = Get-Command npx -ErrorAction SilentlyContinue
    if (-not $Npx) {
        throw 'npx est requis pour qualifier le contrat Windows avant de construire un setup de production.'
    }
    & $Npx.Source --no-install vitest run tests/security/windows-upgrade-contract.test.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Qualification du contrat Windows échouée (exit=$LASTEXITCODE)."
    }

    $UpgradeExercise = Join-Path $RepoRoot 'scripts\test-packaged-upgrade.ps1'
    & $UpgradeExercise
    if ($LASTEXITCODE -ne 0) {
        throw "Qualification transactionnelle Windows échouée (exit=$LASTEXITCODE)."
    }

    # detect-integrations.ps1 -- not configure-install.ps1's own client blocks -- is what the
    # real Setup.exe wizard and install.ps1 actually invoke to wire up clients. A regression
    # here (e.g. a new per-client feature added only to configure-install.ps1) can silently
    # never reach a real end-user install/upgrade despite every other gate passing.
    $ClientIntegrationPreflight = Join-Path $RepoRoot 'packaging\windows\test-client-integration-preflight.ps1'
    & $ClientIntegrationPreflight
    if ($LASTEXITCODE -ne 0) {
        throw "Qualification de la détection/application client Windows échouée (exit=$LASTEXITCODE)."
    }
    Write-Host 'WINDOWS_PRODUCTION_INSTALLER_TRANSACTION_GATES_VALID' -ForegroundColor Green
}

function Get-QualifiedInnoRegistration([string] $ExpectedVersion) {
    $displayName = "Inno Setup version $ExpectedVersion"
    $registrations = @(
        Get-ItemProperty `
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', `
            'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', `
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' `
            -ErrorAction SilentlyContinue |
            Where-Object {
                $displayNameProperty = $_.PSObject.Properties['DisplayName']
                $displayVersionProperty = $_.PSObject.Properties['DisplayVersion']
                $installLocationProperty = $_.PSObject.Properties['InstallLocation']
                $null -ne $displayNameProperty -and
                $null -ne $displayVersionProperty -and
                $null -ne $installLocationProperty -and
                [string]$displayNameProperty.Value -eq $displayName -and
                [string]$displayVersionProperty.Value -eq $ExpectedVersion -and
                -not [string]::IsNullOrWhiteSpace([string]$installLocationProperty.Value)
            }
    )
    if ($registrations.Count -eq 0) {
        throw "Version Inno Setup non qualifiée : inscription $ExpectedVersion introuvable."
    }
    $locations = @(
        $registrations |
            ForEach-Object { [System.IO.Path]::GetFullPath([string]$_.InstallLocation) } |
            Sort-Object -Unique
    )
    if ($locations.Count -ne 1) {
        throw "Version Inno Setup non qualifiée : plusieurs installations $ExpectedVersion enregistrées : $($locations -join ', ')"
    }
    return [PSCustomObject]@{
        DisplayVersion = $ExpectedVersion
        InstallLocation = $locations[0]
        IsccPath = [System.IO.Path]::GetFullPath((Join-Path $locations[0] 'ISCC.exe'))
    }
}

$ExpectedInnoVersion = '6.7.3'
$InnoRegistration = Get-QualifiedInnoRegistration $ExpectedInnoVersion
if (-not (Test-Path -LiteralPath $InnoRegistration.IsccPath -PathType Leaf)) {
    throw "Version Inno Setup non qualifiée : ISCC.exe enregistré introuvable : $($InnoRegistration.IsccPath)"
}

if (-not [string]::IsNullOrWhiteSpace($IsccPath)) {
    $Iscc = [System.IO.Path]::GetFullPath($IsccPath)
    if (-not (Test-Path -LiteralPath $Iscc -PathType Leaf)) {
        throw "Version Inno Setup non qualifiée : ISCC.exe fourni introuvable : $Iscc"
    }
    if (-not $Iscc.Equals($InnoRegistration.IsccPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Version Inno Setup non qualifiée : ISCC.exe ne correspond pas à l'installation $ExpectedInnoVersion enregistrée : fourni=$Iscc enregistré=$($InnoRegistration.IsccPath)"
    }
}
elseif (-not $Smoke) {
    throw "Un setup de production exige -IsccPath vers le binaire Inno Setup $ExpectedInnoVersion déjà vérifié."
}
else {
    $Iscc = $InnoRegistration.IsccPath
}

$IsccOutput = @((& $Iscc /? 2>&1))
$global:LASTEXITCODE = 0
$IsccBanner = ($IsccOutput | Where-Object { $_ -match 'Inno Setup' } | Select-Object -First 1) -as [string]
if ($IsccBanner -notmatch 'Inno Setup 6' -or $IsccBanner -ne 'Inno Setup 6 Command-Line Compiler') {
    throw "Version Inno Setup non qualifiée : attendu=Inno Setup 6 Command-Line Compiler obtenu=$IsccBanner binaire=$Iscc"
}
Write-Host "INNO_SETUP_EXACT_VERSION_QUALIFIED version=$ExpectedInnoVersion path=$Iscc" -ForegroundColor Green

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
$AppId = if ($Smoke) { 'mcp-search-net-Release-Smoke' } else { '{{A3F2C8D1-4B7E-4F9A-8C2D-1E6B0A3F7D5C}' }
$SmokeMode = if ($Smoke) { '1' } else { '0' }

$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Iss = [System.IO.File]::ReadAllText($Template, $Utf8)
$Iss = $Iss.Replace('@@VERSION@@', (Escape-InnoString $Version))
$Iss = $Iss.Replace('@@APP_VERSION@@', (Escape-InnoString $NumericVersion))
$Iss = $Iss.Replace('@@APP_ID@@', (Escape-InnoString $AppId))
$Iss = $Iss.Replace('@@SMOKE_MODE@@', $SmokeMode)
$Iss = $Iss.Replace('@@SOURCE_DIR@@', (Escape-InnoString $DistributionRoot))
$Iss = $Iss.Replace('@@PAYLOAD_ZIP@@', (Escape-InnoString $PayloadZip))
$Iss = $Iss.Replace('@@DISTRIBUTION_NAME@@', (Escape-InnoString $DistributionName))
$Iss = $Iss.Replace('@@OUTPUT_DIR@@', (Escape-InnoString $InstallerOutput))
$Iss = $Iss.Replace('@@OUTPUT_BASENAME@@', (Escape-InnoString $OutputBaseName))
if (-not $Iss.Contains('LicenseFile=')) {
    $LicenseDirective = 'LicenseFile=' + (Escape-InnoString (Join-Path $DistributionRoot 'LICENSE'))
    $Iss = $Iss.Replace('AppPublisher=FTurleque', "AppPublisher=FTurleque`r`n$LicenseDirective")
}
if ($Iss -match '@@[A-Z0-9_]+@@') {
    throw "Token non résolu dans le template Inno Setup : $($Matches[0])"
}
if (-not $Iss.Contains('LicenseFile=')) {
    throw "La licence propriétaire n'est pas présentée par l'installateur Inno Setup."
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
    Write-Host "Payload  : $PayloadZip"
    Write-Host "SHA-256  : $Hash"
    Write-Host "Mode     : $(if ($Smoke) { 'smoke' } else { 'production' })"
    Write-Host "Inno     : $Iscc"
    Write-Host "Inno Ver : $($InnoRegistration.DisplayVersion) | $IsccBanner"
}
finally {
    Remove-Item -LiteralPath $GeneratedIss -Force -ErrorAction SilentlyContinue
}
