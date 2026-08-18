[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Cette recette doit être exécutée sur Windows.'
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Updater = Join-Path $RepoRoot 'packaging\windows\update-installation.ps1'
$Configure = Join-Path $RepoRoot 'packaging\windows\configure-install.ps1'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
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

function Assert-NoTransactionResidue {
    param([Parameter(Mandatory)] [string] $Root)

    if (Test-Path -LiteralPath (Join-Path $Root '.install-staging')) {
        throw 'Le staging transactionnel est resté présent.'
    }
    if (Test-Path -LiteralPath (Join-Path $Root '.install-rollback')) {
        throw 'Le répertoire de rollback transactionnel est resté présent.'
    }
}

function Invoke-ConfigureChild {
    param(
        [Parameter(Mandatory)] [string] $Root,
        [switch] $Uninstall,
        [string] $CrashBeforePublish = ''
    )

    $parameters = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -InstallRoot "{1}" -FromInstaller' -f $Configure, $Root
    if ($Uninstall) { $parameters += ' -Uninstall' }

    $previousCrash = $env:MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH
    try {
        if ($CrashBeforePublish) { $env:MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH = $CrashBeforePublish }
        else { Remove-Item Env:MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH -ErrorAction SilentlyContinue }
        return Start-Process -FilePath $PowerShellExe -ArgumentList $parameters -Wait -PassThru -WindowStyle Hidden
    }
    finally {
        if ($null -eq $previousCrash) {
            Remove-Item Env:MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH -ErrorAction SilentlyContinue
        }
        else {
            $env:MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH = $previousCrash
        }
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

    # A non-empty unrelated root must fail before any managed surface is touched.
    $UnsafeRoot = Join-Path $TestRoot 'unsafe shared root'
    New-Item -ItemType Directory -Force -Path (Join-Path $UnsafeRoot 'app') | Out-Null
    Set-Content -LiteralPath (Join-Path $UnsafeRoot 'app\foreign.marker') -Value 'foreign-data'
    $unsafeRejected = $false
    try {
        & $Updater -PackageRoot $PackageV1 -InstallRoot $UnsafeRoot -SkipProcessStop
    }
    catch {
        $unsafeRejected = $_.Exception.Message -match 'MCP_UPDATE_UNSAFE_INSTALL_ROOT'
        if (-not $unsafeRejected) { throw }
    }
    if (-not $unsafeRejected) { throw 'La racine non détenue n a pas été refusée.' }
    Assert-Contains (Join-Path $UnsafeRoot 'app\foreign.marker') 'foreign-data'
    if (Test-Path -LiteralPath (Join-Path $UnsafeRoot '.mcp-search-net-installation.json')) {
        throw 'La racine non détenue a reçu un marqueur d ownership.'
    }

    # An owned installation must still fail closed if a managed child becomes a junction.
    $ReparseRoot = Join-Path $TestRoot 'owned installation with junction'
    $ExternalConfigRoot = Join-Path $TestRoot 'external config target'
    & $Updater -PackageRoot $PackageV1 -InstallRoot $ReparseRoot -SkipProcessStop
    New-Item -ItemType Directory -Force -Path $ExternalConfigRoot | Out-Null
    Set-Content -LiteralPath (Join-Path $ExternalConfigRoot 'external.marker') -Value 'must-survive'
    Remove-Item -LiteralPath (Join-Path $ReparseRoot 'config') -Recurse -Force
    New-Item -ItemType Junction -Path (Join-Path $ReparseRoot 'config') -Target $ExternalConfigRoot | Out-Null

    $reparseRejected = $false
    try {
        & $Updater -PackageRoot $PackageV2 -InstallRoot $ReparseRoot -SkipProcessStop
    }
    catch {
        $reparseRejected = $_.Exception.Message -match 'MCP_UPDATE_REPARSE_POINT'
        if (-not $reparseRejected) { throw }
    }
    if (-not $reparseRejected) { throw 'La junction interne n a pas été refusée.' }
    Assert-Contains (Join-Path $ExternalConfigRoot 'external.marker') 'must-survive'
    if (Test-Path -LiteralPath (Join-Path $ExternalConfigRoot 'application.yml.default')) {
        throw 'La mise à jour a écrit hors de InstallRoot via la junction.'
    }
    Assert-Contains (Join-Path $ReparseRoot 'app\version.txt') '1.0.0'

    & $Updater -PackageRoot $PackageV1 -InstallRoot $InstallRoot -SkipProcessStop
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.0.0'
    $OwnershipMarker = Join-Path $InstallRoot '.mcp-search-net-installation.json'
    if (-not (Test-Path -LiteralPath $OwnershipMarker -PathType Leaf)) {
        throw 'Le marqueur d ownership de l installation est absent.'
    }
    $ownership = Get-Content -LiteralPath $OwnershipMarker -Raw | ConvertFrom-Json
    if ($ownership.name -ne 'mcp-search-net' -or $ownership.installationId -notmatch '^[0-9a-fA-F-]{36}$') {
        throw 'Le marqueur d ownership est invalide.'
    }

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
    Assert-NoTransactionResidue -Root $InstallRoot

    # Controlled failure still rolls back synchronously.
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
        if ($_.Exception.Message -notmatch 'MCP_UPDATE_TEST_ACTIVATION_FAILURE') { throw }
    }
    if (-not $rollbackObserved) { throw "Le fault injection de rollback n'a pas échoué comme attendu." }

    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v2'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml') 'user-application-setting'
    Assert-Contains (Join-Path $InstallRoot 'data\preserve.marker') 'user-data'
    Assert-NoTransactionResidue -Root $InstallRoot

    # Hard process termination must leave a durable activating record and recover on the next run.
    $crashArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -PackageRoot "{1}" -InstallRoot "{2}" -SkipProcessStop -TestCrashActivationAfterEntries 4' -f `
        $Updater, $PackageV3, $InstallRoot
    $crash = Start-Process -FilePath $PowerShellExe -ArgumentList $crashArguments -Wait -PassThru -WindowStyle Hidden
    if ($crash.ExitCode -eq 0) { throw 'Le processus de fault injection crash a terminé avec succès.' }

    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.2.0'
    $TransactionPath = Join-Path $InstallRoot '.install-rollback\transaction.json'
    if (-not (Test-Path -LiteralPath $TransactionPath -PathType Leaf)) {
        throw 'Le crash n a pas laissé le journal durable attendu.'
    }
    $crashTransaction = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
    if ($crashTransaction.phase -ne 'activating' -or
        $crashTransaction.schemaVersion -ne '1.1' -or
        $crashTransaction.checksumSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Le journal laissé par le crash est invalide.'
    }

    & $Updater -PackageRoot $PackageV2 -InstallRoot $InstallRoot -SkipProcessStop
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.1.0'
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v2'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml') 'user-application-setting'
    Assert-Contains (Join-Path $InstallRoot 'data\preserve.marker') 'user-data'
    Assert-NoTransactionResidue -Root $InstallRoot

    # A failure after the durable commit must not report the activation as failed.
    & $Updater `
        -PackageRoot $PackageV3 `
        -InstallRoot $InstallRoot `
        -SkipProcessStop `
        -TestFailPostCommitCleanup
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.2.0'
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v3'
    $CommittedTransactionPath = Join-Path $InstallRoot '.install-rollback\transaction.json'
    if (-not (Test-Path -LiteralPath $CommittedTransactionPath -PathType Leaf)) {
        throw 'Le fault injection post-commit n a pas laissé le cleanup pending attendu.'
    }
    $committedTransaction = Get-Content -LiteralPath $CommittedTransactionPath -Raw | ConvertFrom-Json
    if ($committedTransaction.phase -ne 'committed') {
        throw 'Le journal post-commit ne marque pas le commit durable.'
    }

    & $Updater -PackageRoot $PackageV3 -InstallRoot $InstallRoot -SkipProcessStop
    Assert-Contains (Join-Path $InstallRoot 'app\version.txt') '1.2.0'
    Assert-Contains (Join-Path $InstallRoot 'app\new.txt') 'new-v3'
    Assert-Contains (Join-Path $InstallRoot 'config\application.yml') 'user-application-setting'
    Assert-Contains (Join-Path $InstallRoot 'data\preserve.marker') 'user-data'
    Assert-NoTransactionResidue -Root $InstallRoot

    # Client configuration files are crash-safe: final state stays intact, then restart cleans orphan staging.
    $ConfigCrashRoot = Join-Path $TestRoot 'config atomic crash'
    New-Item -ItemType Directory -Force -Path $ConfigCrashRoot | Out-Null
    $ExamplePath = Join-Path $ConfigCrashRoot 'mcp.json.example'
    Set-Content -LiteralPath $ExamplePath -Value 'sentinel-before-crash' -NoNewline
    $BeforeHash = (Get-FileHash -LiteralPath $ExamplePath -Algorithm SHA256).Hash
    $configCrash = Invoke-ConfigureChild -Root $ConfigCrashRoot -CrashBeforePublish 'mcp.json.example'
    if ($configCrash.ExitCode -eq 0) { throw 'Le crash de publication de configuration a terminé avec succès.' }
    $AfterHash = (Get-FileHash -LiteralPath $ExamplePath -Algorithm SHA256).Hash
    if ($BeforeHash -ne $AfterHash) { throw 'Le fichier final a été modifié avant la publication atomique.' }

    $configTempsAfterCrash = @(Get-ChildItem -LiteralPath $ConfigCrashRoot -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '.mcp.json.example.tmp-*' })
    if ($configTempsAfterCrash.Count -eq 0) {
        throw 'Le crash n a pas laissé le staging durable attendu avant publication.'
    }

    $configRecovery = Invoke-ConfigureChild -Root $ConfigCrashRoot
    if ($configRecovery.ExitCode -ne 0) { throw "La reprise de configuration a échoué : $($configRecovery.ExitCode)" }
    $configTempsAfterRecovery = @(Get-ChildItem -LiteralPath $ConfigCrashRoot -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '.mcp.json.example.tmp-*' })
    if ($configTempsAfterRecovery.Count -ne 0) {
        throw 'La reprise n a pas nettoyé le staging orphelin de configuration.'
    }
    $recoveredExample = Get-Content -LiteralPath $ExamplePath -Raw | ConvertFrom-Json
    if ($null -eq $recoveredExample.mcpServers.'mcp-search-net') {
        throw 'La reprise n a pas publié un mcp.json.example valide.'
    }

    # A durable metadata failure must be visible to the caller instead of returning success.
    $ConfigFailureRoot = Join-Path $TestRoot 'config material failure'
    New-Item -ItemType Directory -Force -Path $ConfigFailureRoot | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $ConfigFailureRoot 'mcp-client-integrations.json') | Out-Null
    $materialFailure = Invoke-ConfigureChild -Root $ConfigFailureRoot
    if ($materialFailure.ExitCode -eq 0) { throw 'configure-install a masqué un échec matériel de metadata.' }
    if ($materialFailure.ExitCode -ne 20) { throw "Code de partial failure inattendu : $($materialFailure.ExitCode)" }

    # Conservative uninstall removes integrations but preserves generated secrets and backups.
    $PreserveRoot = Join-Path $TestRoot 'configure uninstall preserve'
    New-Item -ItemType Directory -Force -Path $PreserveRoot | Out-Null
    $configureInstall = Invoke-ConfigureChild -Root $PreserveRoot
    if ($configureInstall.ExitCode -ne 0) { throw "Configuration initiale échouée : $($configureInstall.ExitCode)" }
    $PreservedEnv = Join-Path $PreserveRoot '.env'
    $EnvHashBefore = (Get-FileHash -LiteralPath $PreservedEnv -Algorithm SHA256).Hash
    $BackupMarker = Join-Path $PreserveRoot '.config-backups\preserve.marker'
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupMarker -Parent) | Out-Null
    Set-Content -LiteralPath $BackupMarker -Value 'preserve-backup'
    $configureUninstall = Invoke-ConfigureChild -Root $PreserveRoot -Uninstall
    if ($configureUninstall.ExitCode -ne 0) { throw "Nettoyage conservateur échoué : $($configureUninstall.ExitCode)" }
    $EnvHashAfter = (Get-FileHash -LiteralPath $PreservedEnv -Algorithm SHA256).Hash
    if ($EnvHashBefore -ne $EnvHashAfter) { throw '.env n a pas été conservé byte-identical.' }
    Assert-Contains $BackupMarker 'preserve-backup'

    Write-Host 'PACKAGED_IN_PLACE_UPGRADE_VALID'
}
finally {
    if (Test-Path -LiteralPath $TestRoot) {
        Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
