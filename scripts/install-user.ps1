[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch]$StartServices,
    [switch]$RunAfterInstall,
    [switch]$SkipChecks,
    [switch]$ForceStopExistingProcess,
    [switch]$TestFailActivation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NodeVersion = '24.18.0'
$NodeFolderName = "node-v$NodeVersion-win-x64"
$NodeArchiveName = "$NodeFolderName.zip"
$NodeDownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchiveName"
$NodeArchiveSha256 = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$ComposeProject = if ([string]::IsNullOrWhiteSpace($env:MCP_SEARCH_COMPOSE_PROJECT)) {
    'mcp-search-net'
}
else {
    $env:MCP_SEARCH_COMPOSE_PROJECT
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(ValueFromRemainingArguments)] [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "La commande '$FilePath' a échoué avec le code $LASTEXITCODE."
    }
}

function Assert-PathInsideInstallRoot {
    param([Parameter(Mandatory)] [string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootPrefix = $InstallRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Chemin hors de l'installation utilisateur refusé : $fullPath"
    }
}

function Get-CurrentProcessLineage {
    $lineage = @{}
    $processId = [int]$PID

    while ($processId -gt 0 -and -not $lineage.ContainsKey($processId)) {
        $lineage[$processId] = $true
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        if ($null -eq $process -or $null -eq $process.ParentProcessId) {
            break
        }
        $processId = [int]$process.ParentProcessId
    }

    return [int[]]$lineage.Keys
}

function Get-McpSearchNetProcesses {
    param(
        [string]$InstallRootPath = $InstallRoot,
        [int[]]$ExcludeProcessIds = (Get-CurrentProcessLineage)
    )

    $installRootFull = [System.IO.Path]::GetFullPath($InstallRootPath).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $installedLauncher = Join-Path $installRootFull 'bin\mcp-search-net.cmd'
    $installedMain = Join-Path $installRootFull 'app\build\bootstrap\main.js'
    $needles = @(
        $installedLauncher,
        $installedLauncher.Replace('\', '/'),
        $installedMain,
        $installedMain.Replace('\', '/')
    )
    $excluded = @{}
    foreach ($excludedProcessId in $ExcludeProcessIds) {
        $excluded[[int]$excludedProcessId] = $true
    }

    Get-CimInstance Win32_Process |
        Where-Object {
            $isMatch = $false
            if ($null -eq $_.CommandLine) {
                $isMatch = $false
            }
            elseif ($excluded.ContainsKey([int]$_.ProcessId)) {
                $isMatch = $false
            }
            else {
                foreach ($needle in $needles) {
                    if (-not [string]::IsNullOrWhiteSpace($needle) -and
                        $_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        $isMatch = $true
                        break
                    }
                }
            }
            $isMatch
        } |
        Select-Object `
            @{ Name = 'PID'; Expression = { $_.ProcessId } },
            @{ Name = 'Nom'; Expression = { $_.Name } },
            CommandLine
}

function Write-McpSearchNetProcessReport {
    param([Parameter(Mandatory)] [object[]]$Processes)

    foreach ($process in $Processes) {
        Write-Host "PID: $($process.PID)"
        Write-Host "Nom: $($process.Nom)"
        Write-Host "CommandLine: $($process.CommandLine)"
        Write-Host ''
    }
}

function Assert-NoMcpSearchNetProcessLock {
    param([Parameter(Mandatory)] [string]$TargetPath)

    $processes = @(Get-McpSearchNetProcesses)
    if ($processes.Count -eq 0) {
        return
    }

    if ($ForceStopExistingProcess) {
        Write-Warning "Arrêt forcé demandé pour $($processes.Count) processus mcp-search-net suspect(s)."
        Write-McpSearchNetProcessReport -Processes $processes
        foreach ($process in $processes) {
            Stop-Process -Id ([int]$process.PID) -Force -ErrorAction Stop
        }
        Start-Sleep -Milliseconds 500

        $remainingProcesses = @(Get-McpSearchNetProcesses)
        if ($remainingProcesses.Count -gt 0) {
            Write-Host 'Des processus suspects restent actifs après arrêt forcé :'
            Write-McpSearchNetProcessReport -Processes $remainingProcesses
            throw "Installation interrompue : impossible d'arrêter tous les processus pouvant verrouiller $TargetPath."
        }
        return
    }

    Write-Host 'Une ancienne instance de mcp-search-net semble encore active.'
    Write-Host "Fermez IntelliJ/Copilot ou arrêtez le processus ci-dessous avant de relancer l'installation."
    Write-Host ''
    Write-McpSearchNetProcessReport -Processes $processes
    throw "Installation interrompue : $($processes.Count) processus suspect(s) peuvent verrouiller $TargetPath."
}

function Remove-DirectoryWithRetry {
    param([Parameter(Mandatory)] [string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $delays = @(500, 1000, 2000, 3000, 5000)
    $attemptCount = $delays.Count
    $lastError = $null

    for ($attempt = 1; $attempt -le $attemptCount; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            $lastError = $_
            Write-Warning "Suppression impossible de '$Path' (tentative $attempt/$attemptCount) : $($_.Exception.Message)"
            if ($attempt -lt $attemptCount) {
                Start-Sleep -Milliseconds $delays[$attempt - 1]
            }
        }
    }

    throw "Impossible de supprimer '$Path' après $attemptCount tentatives. Dernière erreur : $($lastError.Exception.Message)"
}

function Assert-StagedApplication {
    param([Parameter(Mandatory)] [string]$StageAppPath)

    $mainScript = Join-Path $StageAppPath 'build\bootstrap\main.js'
    $sqlitePackage = Join-Path $StageAppPath 'node_modules\better-sqlite3'
    $historyMigration = Join-Path $StageAppPath 'history-migrations\H001__create_search_history.sql'
    $npmConfig = Join-Path $StageAppPath '.npmrc'
    if (-not (Test-Path -LiteralPath $mainScript -PathType Leaf)) {
        throw "Application staging invalide : $mainScript est absent."
    }
    if (-not (Test-Path -LiteralPath $sqlitePackage -PathType Container)) {
        throw "Application staging invalide : better-sqlite3 n'est pas installé dans $sqlitePackage."
    }
    if (-not (Test-Path -LiteralPath $historyMigration -PathType Leaf)) {
        throw "Application staging invalide : migration historique absente : $historyMigration."
    }
    if (-not (Test-Path -LiteralPath $npmConfig -PathType Leaf)) {
        throw "Application staging invalide : configuration npm absente : $npmConfig."
    }
    $npmConfigContent = Get-Content -LiteralPath $npmConfig -Raw
    if ($npmConfigContent -notmatch '(?m)^strict-allow-scripts=true\s*$') {
        throw "Application staging invalide : strict-allow-scripts=true est absent de $npmConfig."
    }
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA est introuvable. Ce programme nécessite un profil utilisateur Windows.'
}

Write-Host "Installation de mcp-search-net dans $InstallRoot"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$NodeRoot = Join-Path $RuntimeRoot $NodeFolderName
$NodeExe = Join-Path $NodeRoot 'node.exe'
$NpmCmd = Join-Path $NodeRoot 'npm.cmd'
$RuntimeProofPath = Join-Path $RuntimeRoot 'node-runtime-proof.json'
$ArchiveVerifiedAtInstall = $false

if (Test-Path -LiteralPath $RuntimeProofPath -PathType Leaf) {
    try {
        $PreviousRuntimeProof = Get-Content -LiteralPath $RuntimeProofPath -Raw | ConvertFrom-Json
        $ArchiveVerifiedAtInstall =
            $PreviousRuntimeProof.nodeVersion -eq $NodeVersion -and
            $PreviousRuntimeProof.archiveSha256 -eq $NodeArchiveSha256 -and
            $PreviousRuntimeProof.archiveVerifiedAtInstall -eq $true
    }
    catch {
        Write-Warning "Preuve runtime existante illisible ; la signature du binaire sera revérifiée : $RuntimeProofPath"
    }
}

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    $archivePath = Join-Path $RuntimeRoot $NodeArchiveName
    Write-Host "Téléchargement de Node.js $NodeVersion LTS depuis nodejs.org..."
    try {
        Invoke-WebRequest -Uri $NodeDownloadUrl -OutFile $archivePath -UseBasicParsing
        $Verifier = Join-Path $RepositoryRoot 'scripts\windows\verify-file-sha256.ps1'
        & $Verifier -FilePath $archivePath -ExpectedSha256 $NodeArchiveSha256 | Out-Null
        $ArchiveVerifiedAtInstall = $true
        Expand-Archive -LiteralPath $archivePath -DestinationPath $RuntimeRoot -Force
    }
    finally {
        if (Test-Path -LiteralPath $archivePath) {
            Remove-Item -LiteralPath $archivePath -Force
        }
    }
}

if (-not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) {
    throw "Runtime Node.js incomplet : $NpmCmd est absent."
}

$NodeSignature = Get-AuthenticodeSignature -LiteralPath $NodeExe
if ($NodeSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $null -eq $NodeSignature.SignerCertificate -or
    $NodeSignature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') {
    throw "Signature Authenticode Node.js invalide ou signataire inattendu : $($NodeSignature.Status)."
}
$NodeExeSha256 = (Get-FileHash -LiteralPath $NodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
$InstalledNodeVersion = (& $NodeExe '--version').TrimStart('v')
if ($LASTEXITCODE -ne 0 -or $InstalledNodeVersion -ne $NodeVersion) {
    throw "Version Node.js installée invalide : attendu $NodeVersion, obtenu $InstalledNodeVersion."
}
$RuntimeProof = [ordered]@{
    schemaVersion = '1.0'
    nodeVersion = $NodeVersion
    archiveName = $NodeArchiveName
    downloadUrl = $NodeDownloadUrl
    archiveSha256 = $NodeArchiveSha256
    archiveVerifiedAtInstall = $ArchiveVerifiedAtInstall
    nodeExeSha256 = $NodeExeSha256
    signatureStatus = [string]$NodeSignature.Status
    signerSubject = $NodeSignature.SignerCertificate.Subject
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$RuntimeProof | ConvertTo-Json | Set-Content -LiteralPath $RuntimeProofPath -Encoding UTF8
Write-Host "Runtime Node.js vérifié ; preuve : $RuntimeProofPath"

$env:PATH = "$NodeRoot;$env:PATH"

Push-Location $RepositoryRoot
try {
    Write-Host 'Installation reproductible des dépendances de développement...'
    Invoke-NativeCommand $NpmCmd 'ci'

    if ($SkipChecks) {
        Write-Host 'Compilation de production...'
        Invoke-NativeCommand $NpmCmd 'run' 'build'
    }
    else {
        Write-Host 'Validation complète du projet...'
        Invoke-NativeCommand $NpmCmd 'run' 'check'
    }
}
finally {
    Pop-Location
}

$StageRoot = Join-Path $InstallRoot '.install-staging'
$StageApp = Join-Path $StageRoot 'app'
Assert-PathInsideInstallRoot $StageRoot
$AppRoot = Join-Path $InstallRoot 'app'
Assert-PathInsideInstallRoot $AppRoot

try {
    if (Test-Path -LiteralPath $StageRoot) {
        Write-Host "Nettoyage d'un staging précédent : $StageRoot"
        Remove-DirectoryWithRetry -Path $StageRoot
    }
    New-Item -ItemType Directory -Force -Path $StageApp | Out-Null

    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'build') -Destination $StageApp -Recurse
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Destination $StageApp
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package-lock.json') -Destination $StageApp
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.npmrc') -Destination $StageApp
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'migrations') -Destination $StageApp -Recurse
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'catalog-migrations') -Destination $StageApp -Recurse
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'history-migrations') -Destination $StageApp -Recurse

    Push-Location $StageApp
    try {
        Write-Host 'Installation des seules dépendances de production...'
        Invoke-NativeCommand $NpmCmd 'ci' '--omit=dev' '--ignore-scripts=false'
    }
    finally {
        Pop-Location
    }

    Assert-StagedApplication -StageAppPath $StageApp

    $PreviousAppRoot = $null
    if (Test-Path -LiteralPath $AppRoot) {
        Assert-NoMcpSearchNetProcessLock -TargetPath $AppRoot
        $PreviousAppRoot = Join-Path $InstallRoot ("app.previous-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
        Assert-PathInsideInstallRoot $PreviousAppRoot
        Write-Host "Renommage de l'ancienne installation : $PreviousAppRoot"
        try {
            Move-Item -LiteralPath $AppRoot -Destination $PreviousAppRoot -ErrorAction Stop
        }
        catch {
            $processes = @(Get-McpSearchNetProcesses)
            if ($processes.Count -gt 0) {
                Write-Host 'Processus suspects détectés après échec du renommage :'
                Write-McpSearchNetProcessReport -Processes $processes
            }
            throw "Impossible de renommer l'ancienne installation '$AppRoot'. Le staging est conservé dans '$StageRoot'. Dernière erreur : $($_.Exception.Message)"
        }
    }

    try {
        if ($TestFailActivation) {
            throw 'MCP_INSTALL_TEST_ACTIVATION_FAILURE'
        }
        Move-Item -LiteralPath $StageApp -Destination $AppRoot -ErrorAction Stop
    }
    catch {
        Write-Warning "Impossible de déplacer le staging vers '$AppRoot' : $($_.Exception.Message)"
        if ($null -ne $PreviousAppRoot -and
            (Test-Path -LiteralPath $PreviousAppRoot) -and
            -not (Test-Path -LiteralPath $AppRoot)) {
            try {
                Move-Item -LiteralPath $PreviousAppRoot -Destination $AppRoot -ErrorAction Stop
                Write-Warning "Rollback effectué : ancienne installation restaurée depuis $PreviousAppRoot."
            }
            catch {
                Write-Warning "Rollback impossible depuis '$PreviousAppRoot' vers '$AppRoot' : $($_.Exception.Message)"
            }
        }
        throw "Installation interrompue : la nouvelle application n'a pas pu être activée. Le staging reste dans '$StageRoot'."
    }

    if (Test-Path -LiteralPath $StageRoot) {
        try {
            Remove-DirectoryWithRetry -Path $StageRoot
        }
        catch {
            Write-Warning "Le staging reste présent : $StageRoot"
            Write-Warning "Après fermeture des processus suspects, supprimez-le avec : Remove-Item -LiteralPath '$StageRoot' -Recurse -Force"
        }
    }

    if ($null -ne $PreviousAppRoot -and (Test-Path -LiteralPath $PreviousAppRoot)) {
        try {
            Remove-DirectoryWithRetry -Path $PreviousAppRoot
        }
        catch {
            Write-Warning "Ancienne installation verrouillée conservée temporairement : $PreviousAppRoot"
            Write-Warning "La nouvelle installation est active dans : $AppRoot"
            Write-Warning "Après fermeture des processus suspects, supprimez l'ancienne installation avec : Remove-Item -LiteralPath '$PreviousAppRoot' -Recurse -Force"
        }
    }
}
catch {
    if (Test-Path -LiteralPath $StageRoot) {
        Write-Warning "Le dossier de staging reste présent : $StageRoot"
        Write-Warning "Après fermeture des processus suspects, supprimez-le avec : Remove-Item -LiteralPath '$StageRoot' -Recurse -Force"
    }
    throw
}

$ConfigRoot = Join-Path $InstallRoot 'config'
$SearxConfigRoot = Join-Path $ConfigRoot 'searxng'
$DataRoot = Join-Path $InstallRoot 'data'
$BinRoot = Join-Path $InstallRoot 'bin'
New-Item -ItemType Directory -Force -Path $ConfigRoot, $SearxConfigRoot, $DataRoot, $BinRoot | Out-Null

$EnvironmentPath = Join-Path $InstallRoot '.env'
if (-not (Test-Path -LiteralPath $EnvironmentPath -PathType Leaf)) {
    $Crawl4aiLocalToken = New-LocalSecret
    $SearxngLocalSecret = New-LocalSecret
    $EnvironmentContent = @(
        '# Secrets générés localement par install-user.ps1. Ne pas commiter ce fichier.'
        "CRAWL4AI_API_TOKEN=$Crawl4aiLocalToken"
        "SEARXNG_SECRET=$SearxngLocalSecret"
    ) -join "`r`n"
    [System.IO.File]::WriteAllText(
        $EnvironmentPath,
        ($EnvironmentContent + "`r`n"),
        (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Host "Secrets fournisseurs locaux générés dans : $EnvironmentPath"
}

function Copy-UserConfig {
    param(
        [Parameter(Mandatory)] [string]$Source,
        [Parameter(Mandatory)] [string]$Destination
    )

    Copy-Item -LiteralPath $Source -Destination "$Destination.default" -Force
    if (-not (Test-Path -LiteralPath $Destination)) {
        Copy-Item -LiteralPath $Source -Destination $Destination
    }
}

Copy-UserConfig (Join-Path $RepositoryRoot 'config\application.user.yml') (Join-Path $ConfigRoot 'application.yml')
Copy-UserConfig (Join-Path $RepositoryRoot 'config\official-sources.yml') (Join-Path $ConfigRoot 'official-sources.yml')
Copy-UserConfig (Join-Path $RepositoryRoot 'config\searxng\settings.yml') (Join-Path $SearxConfigRoot 'settings.yml')
Copy-UserConfig (Join-Path $RepositoryRoot 'config\application.docker.yml') (Join-Path $ConfigRoot 'application.docker.yml')

Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'compose.yaml') -Destination (Join-Path $InstallRoot 'compose.yaml') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'compose.hybrid.yaml') -Destination (Join-Path $InstallRoot 'compose.hybrid.yaml') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'Dockerfile') -Destination (Join-Path $InstallRoot 'Dockerfile') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.dockerignore') -Destination (Join-Path $InstallRoot '.dockerignore') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.npmrc') -Destination (Join-Path $InstallRoot '.npmrc') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Destination (Join-Path $InstallRoot 'package.json') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package-lock.json') -Destination (Join-Path $InstallRoot 'package-lock.json') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'tsconfig.json') -Destination (Join-Path $InstallRoot 'tsconfig.json') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'tsconfig.build.json') -Destination (Join-Path $InstallRoot 'tsconfig.build.json') -Force
$InstalledMigrations = Join-Path $InstallRoot 'migrations'
$InstalledCatalogMigrations = Join-Path $InstallRoot 'catalog-migrations'
$InstalledHistoryMigrations = Join-Path $InstallRoot 'history-migrations'
foreach ($installedMigrationRoot in @($InstalledMigrations, $InstalledCatalogMigrations, $InstalledHistoryMigrations)) {
    Assert-PathInsideInstallRoot $installedMigrationRoot
    if (Test-Path -LiteralPath $installedMigrationRoot) {
        Remove-Item -LiteralPath $installedMigrationRoot -Recurse -Force
    }
}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'migrations') -Destination $InstalledMigrations -Recurse
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'catalog-migrations') -Destination $InstalledCatalogMigrations -Recurse
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'history-migrations') -Destination $InstalledHistoryMigrations -Recurse
$InstalledSource = Join-Path $InstallRoot 'src'
Assert-PathInsideInstallRoot $InstalledSource
if (Test-Path -LiteralPath $InstalledSource) {
    Remove-Item -LiteralPath $InstalledSource -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'src') -Destination $InstalledSource -Recurse
Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.env.example') -Destination (Join-Path $InstallRoot '.env.example') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\windows\mcp-search-net.cmd') -Destination $BinRoot -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\windows\mcp-search-net-services.cmd') -Destination $BinRoot -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\windows\mcp-search-net-container.cmd') -Destination $BinRoot -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\windows\mcp-search-net-catalog.cmd') -Destination $BinRoot -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\windows\mcp-search-net-maintain.cmd') -Destination $BinRoot -Force

$InstalledDocs = Join-Path $InstallRoot 'docs'
Assert-PathInsideInstallRoot $InstalledDocs
if (Test-Path -LiteralPath $InstalledDocs) {
    Remove-Item -LiteralPath $InstalledDocs -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'docs') -Destination $InstalledDocs -Recurse

$Package = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Raw | ConvertFrom-Json
$Utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $InstallRoot 'VERSION'), "$($Package.version)`r`n", $Utf8WithoutBom)
$SourceRevision = $null
$SourceState = 'UNAVAILABLE'
$Git = Get-Command git -ErrorAction SilentlyContinue
if ($null -ne $Git -and (Test-Path -LiteralPath (Join-Path $RepositoryRoot '.git'))) {
    Push-Location $RepositoryRoot
    try {
        $CandidateRevision = ((& $Git.Source rev-parse --verify HEAD 2>$null) | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $CandidateRevision -match '^[a-f0-9]{40}$') {
            $SourceRevision = $CandidateRevision
            $SourceState = 'REVISION_UNVERIFIED'
            $WorkingTreeStatus = ((& $Git.Source status --porcelain --untracked-files=normal 2>$null) | Out-String).Trim()
            if ($LASTEXITCODE -eq 0) {
                $SourceState = if ([string]::IsNullOrWhiteSpace($WorkingTreeStatus)) { 'CLEAN' } else { 'DIRTY' }
            }
        }
    }
    finally {
        Pop-Location
    }
}
if ($null -eq $SourceRevision -and $env:GITHUB_SHA -match '^[a-fA-F0-9]{40}$') {
    $SourceRevision = $env:GITHUB_SHA.ToLowerInvariant()
    $SourceState = 'CI_UNVERIFIED'
}
$BuildManifest = [ordered]@{
    schemaVersion = '1.0'
    name = [string]$Package.name
    version = [string]$Package.version
    sourceRevision = if ($null -eq $SourceRevision) { 'UNAVAILABLE' } else { $SourceRevision }
    sourceState = $SourceState
    nodeVersion = $NodeVersion
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
[System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'BUILD-MANIFEST.json'),
    (($BuildManifest | ConvertTo-Json -Depth 3) + "`r`n"),
    $Utf8WithoutBom
)

$Launcher = Join-Path $BinRoot 'mcp-search-net.cmd'
$McpExample = [ordered]@{
    mcpServers = [ordered]@{
        'mcp-search-net' = [ordered]@{
            type = 'local'
            command = 'cmd.exe'
            args = @('/d', '/s', '/c', $Launcher)
            env = [ordered]@{
                MCP_SEARCH_HOME = $InstallRoot
            }
            tools = @('*')
        }
    }
}
[System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'mcp.json.example'),
    (($McpExample | ConvertTo-Json -Depth 5) + "`r`n"),
    $Utf8WithoutBom
)

$ContainerLauncher = Join-Path $BinRoot 'mcp-search-net-container.cmd'
$ContainerExample = [ordered]@{
    mcpServers = [ordered]@{
        'mcp-search-net-container' = [ordered]@{
            type = 'local'
            command = 'cmd.exe'
            args = @('/d', '/s', '/c', $ContainerLauncher)
            env = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
            tools = @('*')
        }
    }
}
[System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'mcp.container.json.example'),
    (($ContainerExample | ConvertTo-Json -Depth 5) + "`r`n"),
    $Utf8WithoutBom
)

Write-Host "Installation terminée. Lanceur MCP : $Launcher"
Write-Host "Exemple Copilot : $(Join-Path $InstallRoot 'mcp.json.example')"

if ($StartServices) {
    $Docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -eq $Docker) {
        throw 'Docker est absent du PATH. Installez ou démarrez Docker Desktop, puis relancez avec -StartServices.'
    }
    if ($ComposeProject -ne 'mcp-search-net-user') {
        Write-Host "Arrêt éventuel de l'ancien projet Compose mcp-search-net-user..."
        & $Docker.Source 'compose' '--env-file' $EnvironmentPath '-p' 'mcp-search-net-user' '-f' (Join-Path $InstallRoot 'compose.yaml') '-f' (Join-Path $InstallRoot 'compose.hybrid.yaml') 'down'
        if ($LASTEXITCODE -ne 0) {
            throw "La commande '$($Docker.Source)' a échoué avec le code $LASTEXITCODE."
        }
    }
    Write-Host 'Démarrage de SearXNG et Crawl4AI...'
    Invoke-NativeCommand $Docker.Source 'compose' '--env-file' $EnvironmentPath '-p' $ComposeProject '-f' (Join-Path $InstallRoot 'compose.yaml') '-f' (Join-Path $InstallRoot 'compose.hybrid.yaml') 'up' '-d' '--wait' 'searxng' 'crawl4ai'
}

if ($RunAfterInstall) {
    Write-Host "Démarrage du serveur MCP STDIO (arrêter avec Ctrl+C)..."
    & $Launcher
    exit $LASTEXITCODE
}
