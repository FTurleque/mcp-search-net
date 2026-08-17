[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PackageRoot,
    [Parameter(Mandatory)] [string] $InstallRoot,
    [switch] $SkipProcessStop,
    [int] $TestFailActivationAfterEntries = 0,
    [int] $TestCrashActivationAfterEntries = 0,
    [switch] $TestFailPostCommitCleanup
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Ce programme necessite Windows x64.'
}

$PackageRoot = [System.IO.Path]::GetFullPath($PackageRoot)
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$StageRoot = Join-Path $InstallRoot '.install-staging'
$RollbackRoot = Join-Path $InstallRoot '.install-rollback'
$RollbackOldRoot = Join-Path $RollbackRoot 'old'
$TransactionPath = Join-Path $RollbackRoot 'transaction.json'
$OwnershipMarkerPath = Join-Path $InstallRoot '.mcp-search-net-installation.json'
$ManagedApplicationName = 'mcp-search-net'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Normalize-ComparablePath {
    param([Parameter(Mandatory)] [string] $Path)

    $trimChars = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    return [System.IO.Path]::GetFullPath($Path).TrimEnd($trimChars)
}

function Assert-PathInsideRoot {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Root
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullRoot = Normalize-ComparablePath -Path $Root
    $prefix = $fullRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Chemin hors de la racine autorisee : $fullPath"
    }
}

function Test-SamePath {
    param(
        [Parameter(Mandatory)] [string] $Left,
        [Parameter(Mandatory)] [string] $Right
    )

    return (Normalize-ComparablePath -Path $Left).Equals(
        (Normalize-ComparablePath -Path $Right),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Get-ForbiddenInstallRoots {
    $candidates = @(
        [System.IO.Path]::GetPathRoot($InstallRoot),
        $env:USERPROFILE,
        $env:LOCALAPPDATA,
        $env:APPDATA,
        $env:ProgramData,
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:SystemRoot,
        $env:TEMP,
        [System.IO.Path]::GetTempPath()
    )
    return @($candidates | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
}

function Test-OwnershipMarker {
    if (-not (Test-Path -LiteralPath $OwnershipMarkerPath -PathType Leaf)) { return $false }
    try {
        $marker = Get-Content -LiteralPath $OwnershipMarkerPath -Raw | ConvertFrom-Json
        return (
            [string]$marker.schemaVersion -eq '1.0' -and
            [string]$marker.name -eq $ManagedApplicationName -and
            [guid]::TryParse([string]$marker.installationId, [ref]([guid]::Empty))
        )
    }
    catch {
        return $false
    }
}

function Test-LegacyOwnedInstallation {
    $manifestPath = Join-Path $InstallRoot 'BUILD-MANIFEST.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ([string]$manifest.name -ne $ManagedApplicationName) { return $false }
    }
    catch {
        return $false
    }

    return (
        (Test-Path -LiteralPath (Join-Path $InstallRoot 'app\build\bootstrap\main.js') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $InstallRoot 'bin\mcp-search-net.cmd') -PathType Leaf)
    )
}

function Assert-SafeInstallRoot {
    foreach ($forbiddenRoot in (Get-ForbiddenInstallRoots)) {
        if (Test-SamePath -Left $InstallRoot -Right ([string]$forbiddenRoot)) {
            throw "MCP_UPDATE_UNSAFE_INSTALL_ROOT: racine systeme ou utilisateur interdite : $InstallRoot"
        }
    }

    if (-not (Test-Path -LiteralPath $InstallRoot)) { return }
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
        throw "MCP_UPDATE_UNSAFE_INSTALL_ROOT: le chemin existe mais n'est pas un dossier : $InstallRoot"
    }

    $rootItem = Get-Item -LiteralPath $InstallRoot -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "MCP_UPDATE_UNSAFE_INSTALL_ROOT: une racine d'installation de type reparse point est refusee : $InstallRoot"
    }

    $children = @(Get-ChildItem -LiteralPath $InstallRoot -Force)
    if ($children.Count -eq 0) { return }
    if (Test-OwnershipMarker) { return }
    if (Test-LegacyOwnedInstallation) { return }

    throw "MCP_UPDATE_UNSAFE_INSTALL_ROOT: dossier non vide sans preuve d'ownership mcp-search-net : $InstallRoot"
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)] [string] $Value)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $Utf8NoBom.GetBytes($Value)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Write-DurableUtf8File {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Content
    )

    $directory = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    $temporaryPath = Join-Path $directory ('.' + [System.IO.Path]::GetFileName($Path) + '.tmp-' + [guid]::NewGuid().ToString('N'))
    $stream = $null
    try {
        $bytes = $Utf8NoBom.GetBytes($Content)
        $stream = [System.IO.FileStream]::new(
            $temporaryPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None,
            4096,
            [System.IO.FileOptions]::WriteThrough
        )
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null

        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [System.IO.File]::Replace($temporaryPath, $Path, $null, $true)
        }
        else {
            [System.IO.File]::Move($temporaryPath, $Path)
        }
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-OwnershipMarker {
    if (Test-OwnershipMarker) { return }

    $marker = [ordered]@{
        schemaVersion = '1.0'
        name = $ManagedApplicationName
        installationId = [guid]::NewGuid().ToString('D')
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $content = ($marker | ConvertTo-Json -Depth 4) + "`r`n"
    Write-DurableUtf8File -Path $OwnershipMarkerPath -Content $content
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
    throw "Impossible de supprimer '$Path'. Derniere erreur : $($lastError.Exception.Message)"
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
    throw "Impossible de deplacer '$Source' vers '$Destination'. Derniere erreur : $($lastError.Exception.Message)"
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
    return @($lineage.Keys | ForEach-Object { [int]$_ })
}

function Get-InstalledMcpProcesses {
    $needles = @(
        (Join-Path $InstallRoot 'bin\mcp-search-net.cmd'),
        (Join-Path $InstallRoot 'app\build\bootstrap\main.js')
    )
    $excluded = @{}
    foreach ($processId in (Get-CurrentProcessLineage)) { $excluded[[int]$processId] = $true }

    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        if ($null -eq $_.CommandLine -or $excluded.ContainsKey([int]$_.ProcessId)) { return $false }
        foreach ($needle in $needles) {
            if ($_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
        return $false
    })
}

function Stop-InstalledMcpProcesses {
    if ($SkipProcessStop -or -not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return }

    $matches = @(Get-InstalledMcpProcesses)
    foreach ($process in $matches) {
        Write-Host "Arret du serveur MCP installe PID=$($process.ProcessId) ($($process.Name))..."
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
    }
    if ($matches.Count -gt 0) { Start-Sleep -Milliseconds 500 }

    $remaining = @(Get-InstalledMcpProcesses)
    if ($remaining.Count -gt 0) {
        throw "MCP_UPDATE_PROCESS_LOCK: $($remaining.Count) processus mcp-search-net restent actifs."
    }
}

function New-TransactionCore {
    param(
        [Parameter(Mandatory)] [string] $Phase,
        [Parameter(Mandatory)] [object[]] $Entries,
        [Parameter(Mandatory)] [string] $UpdatedAt
    )

    return [ordered]@{
        schemaVersion = '1.1'
        phase = $Phase
        entries = $Entries
        updatedAt = $UpdatedAt
    }
}

function Write-TransactionManifest {
    param(
        [Parameter(Mandatory)] [string] $Phase,
        [Parameter(Mandatory)] [object[]] $Entries
    )

    $updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $core = New-TransactionCore -Phase $Phase -Entries $Entries -UpdatedAt $updatedAt
    $checksum = Get-Sha256Hex -Value ($core | ConvertTo-Json -Depth 8 -Compress)
    $manifest = [ordered]@{
        schemaVersion = $core.schemaVersion
        phase = $core.phase
        entries = $core.entries
        updatedAt = $core.updatedAt
        checksumSha256 = $checksum
    }
    Write-DurableUtf8File -Path $TransactionPath -Content (($manifest | ConvertTo-Json -Depth 8) + "`r`n")
}

function Read-TransactionManifest {
    if (-not (Test-Path -LiteralPath $TransactionPath -PathType Leaf)) {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: transaction absente dans $RollbackRoot"
    }
    try {
        $transaction = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: journal de transaction illisible : $($_.Exception.Message)"
    }

    $schemaVersion = [string]$transaction.schemaVersion
    if ($schemaVersion -eq '1.0') {
        return $transaction
    }
    if ($schemaVersion -ne '1.1') {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: schema de transaction inconnu '$schemaVersion'."
    }

    $core = New-TransactionCore `
        -Phase ([string]$transaction.phase) `
        -Entries @($transaction.entries) `
        -UpdatedAt ([string]$transaction.updatedAt)
    $actualChecksum = Get-Sha256Hex -Value ($core | ConvertTo-Json -Depth 8 -Compress)
    if ([string]$transaction.checksumSha256 -ne $actualChecksum) {
        throw 'MCP_UPDATE_RECOVERY_REQUIRED: checksum du journal de transaction invalide.'
    }
    return $transaction
}

function Restore-Transaction {
    param([Parameter(Mandatory)] [object] $Transaction)

    $rollbackEntries = @($Transaction.entries | Sort-Object -Property order -Descending)
    foreach ($entry in $rollbackEntries) {
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
        elseif ((-not (Test-Path -LiteralPath $staged)) -and (Test-Path -LiteralPath $target)) {
            Remove-PathWithRetry -Path $target
        }
    }

    if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
    if (Test-Path -LiteralPath $RollbackRoot) { Remove-PathWithRetry -Path $RollbackRoot }
}

function Recover-UnpublishedTransaction {
    $backupItems = @()
    if (Test-Path -LiteralPath $RollbackOldRoot -PathType Container) {
        $backupItems = @(Get-ChildItem -LiteralPath $RollbackOldRoot -Force)
    }
    if ($backupItems.Count -gt 0) {
        throw 'MCP_UPDATE_RECOVERY_REQUIRED: journal absent alors que des backups d activation existent.'
    }

    Write-Warning 'Transaction interrompue avant publication du journal ; nettoyage du staging non active.'
    if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
    if (Test-Path -LiteralPath $RollbackRoot) { Remove-PathWithRetry -Path $RollbackRoot }
}

function Recover-InterruptedTransaction {
    if (-not (Test-Path -LiteralPath $RollbackRoot -PathType Container)) {
        if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
        return
    }

    if (-not (Test-Path -LiteralPath $TransactionPath -PathType Leaf)) {
        Recover-UnpublishedTransaction
        return
    }

    $transaction = Read-TransactionManifest
    if ([string]$transaction.phase -eq 'committed') {
        Write-Host "Nettoyage d'une transaction de mise a jour deja commitee."
        if (Test-Path -LiteralPath $StageRoot) { Remove-PathWithRetry -Path $StageRoot }
        Remove-PathWithRetry -Path $RollbackRoot
        return
    }
    if ([string]$transaction.phase -ne 'activating') {
        throw "MCP_UPDATE_RECOVERY_REQUIRED: phase inconnue '$($transaction.phase)'."
    }

    Write-Warning 'Transaction de mise a jour interrompue ; restauration de la version precedente.'
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
        if ([string]$manifest.name -ne $ManagedApplicationName) { throw 'nom application invalide' }
        if ([string]::IsNullOrWhiteSpace([string]$manifest.version)) { throw 'version absente' }
        return $manifest
    }
    catch {
        throw "MCP_UPDATE_INVALID_PACKAGE: BUILD-MANIFEST.json invalide : $($_.Exception.Message)"
    }
}

function Invoke-PostCommitCleanup {
    $cleanupFailures = New-Object System.Collections.Generic.List[string]

    if ($TestFailPostCommitCleanup) {
        $cleanupFailures.Add('fault-injection')
    }
    else {
        foreach ($path in @($StageRoot, $RollbackRoot)) {
            try {
                if (Test-Path -LiteralPath $path) { Remove-PathWithRetry -Path $path }
            }
            catch {
                $cleanupFailures.Add("$path : $($_.Exception.Message)")
            }
        }
    }

    $legacyInstaller = Join-Path $InstallRoot 'install.ps1'
    try {
        if (Test-Path -LiteralPath $legacyInstaller -PathType Leaf) {
            Remove-PathWithRetry -Path $legacyInstaller
        }
    }
    catch {
        $cleanupFailures.Add("$legacyInstaller : $($_.Exception.Message)")
    }

    foreach ($failure in $cleanupFailures) {
        Write-Warning "MCP_UPDATE_CLEANUP_PENDING: $failure"
    }
    return $cleanupFailures.Count
}

$entries = @()
$order = 0

function Add-StagedDirectory {
    param(
        [Parameter(Mandatory)] [string] $SourceRelativePath,
        [Parameter(Mandatory)] [string] $TargetRelativePath
    )

    $source = Join-Path $PackageRoot $SourceRelativePath
    $staged = Join-Path $StageRoot $TargetRelativePath
    $target = Join-Path $InstallRoot $TargetRelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $staged -Parent) | Out-Null
    Copy-Item -LiteralPath $source -Destination $staged -Recurse -Force
    $script:order++
    $script:entries += [PSCustomObject]@{
        order = $script:order
        relativePath = $TargetRelativePath
        hadOriginal = [bool](Test-Path -LiteralPath $target)
    }
}

function Add-StagedFile {
    param(
        [Parameter(Mandatory)] [string] $SourceRelativePath,
        [Parameter(Mandatory)] [string] $TargetRelativePath
    )

    $source = Join-Path $PackageRoot $SourceRelativePath
    $staged = Join-Path $StageRoot $TargetRelativePath
    $target = Join-Path $InstallRoot $TargetRelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $staged -Parent) | Out-Null
    Copy-Item -LiteralPath $source -Destination $staged -Force
    $script:order++
    $script:entries += [PSCustomObject]@{
        order = $script:order
        relativePath = $TargetRelativePath
        hadOriginal = [bool](Test-Path -LiteralPath $target)
    }
}

$packageManifest = Assert-Package
Assert-SafeInstallRoot
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Assert-PathInsideRoot -Path $StageRoot -Root $InstallRoot
Assert-PathInsideRoot -Path $RollbackRoot -Root $InstallRoot
Ensure-OwnershipMarker
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
Write-TransactionManifest -Phase 'activating' -Entries $entries

$activationCount = 0
try {
    foreach ($entry in $entries) {
        $relativePath = [string]$entry.relativePath
        $target = Join-Path $InstallRoot $relativePath
        $staged = Join-Path $StageRoot $relativePath
        $backup = Join-Path $RollbackOldRoot $relativePath

        if ([bool]$entry.hadOriginal) {
            Move-PathWithRetry -Source $target -Destination $backup
        }
        Move-PathWithRetry -Source $staged -Destination $target

        $activationCount++
        if ($TestCrashActivationAfterEntries -gt 0 -and $activationCount -eq $TestCrashActivationAfterEntries) {
            Write-Host "MCP_UPDATE_TEST_CRASH_AFTER_ENTRY:$activationCount"
            [System.Diagnostics.Process]::GetCurrentProcess().Kill()
            throw "MCP_UPDATE_TEST_CRASH_FAILED_TO_TERMINATE:$activationCount"
        }
        if ($TestFailActivationAfterEntries -gt 0 -and $activationCount -eq $TestFailActivationAfterEntries) {
            throw "MCP_UPDATE_TEST_ACTIVATION_FAILURE:$activationCount"
        }
    }

    Write-TransactionManifest -Phase 'committed' -Entries $entries
}
catch {
    $activationError = $_
    try {
        Restore-Transaction -Transaction (Read-TransactionManifest)
    }
    catch {
        throw "MCP_UPDATE_ROLLBACK_FAILED: activation='$($activationError.Exception.Message)' rollback='$($_.Exception.Message)'"
    }
    throw $activationError
}

$cleanupFailureCount = Invoke-PostCommitCleanup
$cleanupState = if ($cleanupFailureCount -eq 0) { 'complete' } else { 'pending' }
Write-Host "MCP_UPDATE_COMMITTED version=$($packageManifest.version) root=$InstallRoot cleanup=$cleanupState"
