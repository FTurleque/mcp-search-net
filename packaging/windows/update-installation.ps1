[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PackageRoot,
    [Parameter(Mandatory)] [string] $InstallRoot,
    [switch] $SkipProcessStop,
    [int] $TestFailActivationAfterEntries = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Ce programme nécessite Windows x64.'
}

$PackageRoot = [System.IO.Path]::GetFullPath($PackageRoot)
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$StageRoot = Join-Path $InstallRoot '.install-staging'
$RollbackRoot = Join-Path $InstallRoot '.install-rollback'
$RollbackOldRoot = Join-Path $RollbackRoot 'old'
$TransactionPath = Join-Path $RollbackRoot 'transaction.json'

function Assert-PathInsideRoot {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Root
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $prefix = $fullRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Chemin hors de la racine autorisée : $fullPath"
    }
}

function Remove-PathWithRetry {
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $delays = @(250, 500, 1000, 2000, 3000)
    $lastError = $null
    for ($attempt = 0; $attempt -lt $delays.Count; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            $lastError = $_
            if ($attempt -lt ($delays.Count - 1)) {
                Start-Sleep -Milliseconds $delays[$attempt]
            }
        }
    }
    throw "Impossible de supprimer '$Path'. Dernière erreur : $($lastError.Exception.Message)"
}

function Move-PathWithRetry {
    param(
        [Parameter(Mandatory)] [string] $Source,
        [Parameter(Mandatory)] [string] $Destination
    )

    $parent = Split-Path $Destination -Parent
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    $delays = @(250, 500, 1000, 2000, 3000)
    $lastError = $null
    for ($attempt = 0; $attempt -lt $delays.Count; $attempt++) {
        try {
            Move-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            return
        }
        catch {
            $lastError = $_
            if ($attempt -lt ($delays.Count - 1)) {
                Start-Sleep -Milliseconds $delays[$attempt]
            }
        }
    }
    throw "Impossible de déplacer '$Source' vers '$Destination'. Dernière erreur : $($lastError.Exception.Message)"
}

function Get-CurrentProcessLineage {
    $lineage = @{}
    $processId = [int]$PID
    while ($processId -gt 0 -and -not $lineage.ContainsKey($processId)) {
        $lineage[$processId] = $true
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if ($null -eq $process -or $null -eq $process.ParentProcessId) { break }
        $processId = [int]$process.ParentProcessId
    }
    return [int[]]$lineage.Keys
}

function Stop-InstalledMcpProcesses {
    if ($SkipProcessStop -or -not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return }

    $needles = @(
        (Join-Path $InstallRoot 'bin\mcp-search-net.cmd'),
        (Join-Path $InstallRoot 'app\build\bootstrap\main.js'),
        (Join-Path $InstallRoot 'runtime\node-v24.18.0-win-x64\node.exe')
    )
    $excluded = @{}
    foreach ($processId in (Get-CurrentProcessLineage)) { $excluded[[int]$processId] = $true }

    $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        if ($null -eq $_.CommandLine -or $excluded.ContainsKey([int]$_.ProcessId)) { return $false }
        foreach ($needle in $needles) {
            if ($_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
        return $false
    })

    foreach ($process in $matches) {
        Write-Host "Arrêt du serveur MCP installé PID=$($process.ProcessId) ($($process.Name))..."
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
    }
    if ($matches.Count -gt 0) { Start-Sleep -Milliseconds 500 }

    $remaining = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        if ($null -eq $_.CommandLine -or $excluded.ContainsKey([int]$_.ProcessId)) { return $false }
        foreach ($needle in $needles) {
            if ($_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
        return $false
    })
    if ($remaining.Count -gt 0) {
        throw "MCP_UPDATE_PROCESS_LOCK: $($remaining.Count) processus mcp-search-net restent actifs."
    }
}

function Write-TransactionManifest {
    param(
        [Parameter(Mandatory)] [string] $Phase,
        [Parameter(Mandatory)] [object[]] $Entries
    )

    $manifest = [ordered]@{
        schemaVersion = '1.0'
        phase = $Phase
        entries = $Entries
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $TransactionPath -Encoding UTF8
}

function Read-TransactionManifest {
    if (-not (Test-Path -LiteralPath $TransactionPath -PathType Leaf)) {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: transaction absente dans $RollbackRoot"
    }
    try {
        return (Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json)
    }
    catch {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: journal de transaction illisible : $($_.Exception.Message)"
    }
}

function Restore-Transaction {
    param([Parameter(Mandatory)] [object] $Transaction)

    foreach ($entry in @($Transaction.entries) | Sort-Object -Property order -Descending) {
        $relativePath = [string]$entry.relativePath
        $target = Join-Path $InstallRoot $relativePath
        $staged = Join-Path $StageRoot $relativePath
        $backup = Join-Path $RollbackOldRoot $relativePath
        Assert-PathInsideRoot -Path $target -Root $InstallRoot

        if ([bool]$entry.hadOriginal) {
            if (Test-Path -LiteralPath $backup) {
                if (Test-Path -LiteralPath $target) { Remove-PathWithRetry -Path $target }
                Move-PathWithRetry -Source $backup -Destination $target
            }
        }
        else {
            # A missing staged entry means it was already activated. Remove it when rolling back.
            if ((-not (Test-Path -LiteralPath $staged)) -and (Test-Path -LiteralPath $target)) {
                Remove-PathWithRetry -Path $target
            }
        }
    }

    if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
    if (Test-Path -LiteralPath $RollbackRoot) { Remove-PathWithRetry -Path $RollbackRoot }
}

function Recover-InterruptedTransaction {
    if (-not (Test-Path -LiteralPath $RollbackRoot -PathType Container)) {
        if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
        return
    }

    $transaction = Read-TransactionManifest
    if ([string]$transaction.phase -eq 'committed') {
        Write-Host 'Nettoyage d’une transaction de mise à jour déjà commitée.'
        if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
        Remove-PathWithRetry -Path $RollbackRoot
        return
    }
    if ([string]$transaction.phase -ne 'activating') {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: phase inconnue '$($transaction.phase)'."
    }

    Write-Warning 'Transaction de mise à jour interrompue détectée ; restauration de la version précédente.'
    Restore-Transaction -Transaction $transaction
}

function Assert-Package {
    $required = @(
        'app\build\bootstrap\main.js',
        'bin\mcp-search-net.cmd',
        'runtime\node-v24.18.0-win-x64\node.exe',
        'scripts\configure-install.ps1',
        'docker\compose.yaml',
        'docker\compose.hybrid.yaml',
        'docker\.dockerignore',
        'BUILD-MANIFEST.json',
        'LICENSE',
        'THIRD-PARTY-NOTICES.txt',
        'config\application.yml',
        'config\application.docker.yml',
        'config\official-sources.yml',
        'config\searxng\settings.yml'
    )
    foreach ($relativePath in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot $relativePath))) {
            throw "MCP_UPDATE_INVALID_PACKAGE: artefact absent '$relativePath'."
        }
    }

    try {
        $manifest = Get-Content -LiteralPath (Join-Path $PackageRoot 'BUILD-MANIFEST.json') -Raw | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace([string]$manifest.version)) {
            throw 'version absente'
        }
    }
    catch {
        throw "MCP_UPDATE_INVALID_PACKAGE: BUILD-MANIFEST.json invalide : $($_.Exception.Message)"
    }
}

$entries = New-Object System.Collections.Generic.List[object]
$order = 0

function Add-StagedDirectory {
    param(
        [Parameter(Mandatory)] [string] $SourceRelativePath,
        [Parameter(Mandatory)] [string] $TargetRelativePath
    )

    $source = Join-Path $PackageRoot $SourceRelativePath
    $staged = Join-Path $StageRoot $TargetRelativePath
    $target = Join-Path $InstallRoot $TargetRelativePath
    $parent = Split-Path $staged -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $staged -Recurse -Force
    $script:order++
    $entries.Add([PSCustomObject]@{
        order = $script:order
        relativePath = $TargetRelativePath
        hadOriginal = [bool](Test-Path -LiteralPath $target)
    })
}

function Add-StagedFile {
    param(
        [Parameter(Mandatory)] [string] $SourceRelativePath,
        [Parameter(Mandatory)] [string] $TargetRelativePath
    )

    $source = Join-Path $PackageRoot $SourceRelativePath
    $staged = Join-Path $StageRoot $TargetRelativePath
    $target = Join-Path $InstallRoot $TargetRelativePath
    $parent = Split-Path $staged -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $staged -Force
    $script:order++
    $entries.Add([PSCustomObject]@{
        order = $script:order
        relativePath = $TargetRelativePath
        hadOriginal = [bool](Test-Path -LiteralPath $target)
    })
}

Assert-Package
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Assert-PathInsideRoot -Path $StageRoot -Root $InstallRoot
Assert-PathInsideRoot -Path $RollbackRoot -Root $InstallRoot
Recover-InterruptedTransaction
Stop-InstalledMcpProcesses

New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null

foreach ($directory in @('app', 'bin', 'runtime', 'scripts', 'docker')) {
    Add-StagedDirectory -SourceRelativePath $directory -TargetRelativePath $directory
}
foreach ($file in @('BUILD-MANIFEST.json', 'LICENSE', 'THIRD-PARTY-NOTICES.txt')) {
    Add-StagedFile -SourceRelativePath $file -TargetRelativePath $file
}
Add-StagedFile -SourceRelativePath 'docker\compose.yaml' -TargetRelativePath 'compose.yaml'
Add-StagedFile -SourceRelativePath 'docker\compose.hybrid.yaml' -TargetRelativePath 'compose.hybrid.yaml'
Add-StagedFile -SourceRelativePath 'docker\.dockerignore' -TargetRelativePath '.dockerignore'

$configTemplates = @(
    @{ source = 'config\application.yml'; target = 'config\application.yml' },
    @{ source = 'config\application.docker.yml'; target = 'config\application.docker.yml' },
    @{ source = 'config\official-sources.yml'; target = 'config\official-sources.yml' },
    @{ source = 'config\searxng\settings.yml'; target = 'config\searxng\settings.yml' }
)
foreach ($template in $configTemplates) {
    $targetPath = Join-Path $InstallRoot $template.target
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
        Add-StagedFile -SourceRelativePath $template.source -TargetRelativePath $template.target
    }
    Add-StagedFile -SourceRelativePath $template.source -TargetRelativePath ($template.target + '.default')
}

New-Item -ItemType Directory -Force -Path $RollbackOldRoot | Out-Null
Write-TransactionManifest -Phase 'activating' -Entries @($entries)

$activationCount = 0
try {
    foreach ($entry in @($entries)) {
        $relativePath = [string]$entry.relativePath
        $target = Join-Path $InstallRoot $relativePath
        $staged = Join-Path $StageRoot $relativePath
        $backup = Join-Path $RollbackOldRoot $relativePath

        if ([bool]$entry.hadOriginal) {
            Move-PathWithRetry -Source $target -Destination $backup
        }
        Move-PathWithRetry -Source $staged -Destination $target

        $activationCount++
        if ($TestFailActivationAfterEntries -gt 0 -and $activationCount -eq $TestFailActivationAfterEntries) {
            throw "MCP_UPDATE_TEST_ACTIVATION_FAILURE:$activationCount"
        }
    }

    Write-TransactionManifest -Phase 'committed' -Entries @($entries)
}
catch {
    $activationError = $_
    try {
        $transaction = Read-TransactionManifest
        Restore-Transaction -Transaction $transaction
    }
    catch {
        throw "MCP_UPDATE_ROLLBACK_FAILED: activation='$($activationError.Exception.Message)' rollback='$($_.Exception.Message)'"
    }
    throw $activationError
}

if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
if (Test-Path -LiteralPath $RollbackRoot) { Remove-PathWithRetry -Path $RollbackRoot }

$installedManifest = Get-Content -LiteralPath (Join-Path $InstallRoot 'BUILD-MANIFEST.json') -Raw | ConvertFrom-Json
Write-Host "MCP_UPDATE_COMMITTED version=$($installedManifest.version) root=$InstallRoot"
