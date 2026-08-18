[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$NodeRuntimeSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mcp-search-net-install-" + [guid]::NewGuid().ToString('N'))
$SourceRoot = Join-Path $TestRoot 'source'
$OriginalLocalAppData = $env:LOCALAPPDATA
$env:LOCALAPPDATA = Join-Path $TestRoot 'Local App Data'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'mcp-search-net'
$InstallScript = Join-Path $SourceRoot 'scripts\install-user.ps1'
$UninstallScript = Join-Path $SourceRoot 'scripts\uninstall-user.ps1'

function Assert-ThrowsLike {
    param(
        [Parameter(Mandatory)] [scriptblock]$Action,
        [Parameter(Mandatory)] [string]$Pattern,
        [Parameter(Mandatory)] [string]$FailureMessage
    )
    $observed = $false
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -like $Pattern) {
            $observed = $true
        }
        else {
            throw
        }
    }
    if (-not $observed) { throw $FailureMessage }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $NodeRuntimeSource 'node.exe') -PathType Leaf)) {
        throw "Runtime Node.js du runner invalide : $NodeRuntimeSource"
    }

    New-Item -ItemType Directory -Force -Path $SourceRoot | Out-Null
    $ExcludedSourceEntries = @('.git', 'node_modules', 'build', 'coverage', '.data', 'target')
    foreach ($entry in Get-ChildItem -LiteralPath $RepositoryRoot -Force) {
        if ($ExcludedSourceEntries -notcontains $entry.Name) {
            Copy-Item -LiteralPath $entry.FullName -Destination $SourceRoot -Recurse -Force
        }
    }

    $CustomRoot = Join-Path $TestRoot 'custom-install'
    Assert-ThrowsLike `
        -Action { & $InstallScript -InstallRoot $CustomRoot -SkipChecks } `
        -Pattern 'MCP_INSTALL_CUSTOM_ROOT_REQUIRES_OPT_IN:*' `
        -FailureMessage "Une racine personnalisee a ete acceptee sans opt-in explicite."

    $ForeignRoot = Join-Path $TestRoot 'foreign-root'
    New-Item -ItemType Directory -Force -Path $ForeignRoot | Out-Null
    $ForeignSentinel = Join-Path $ForeignRoot 'foreign.txt'
    Set-Content -LiteralPath $ForeignSentinel -Value 'must-survive'
    Assert-ThrowsLike `
        -Action { & $InstallScript -InstallRoot $ForeignRoot -SkipChecks -AllowCustomInstallRoot } `
        -Pattern 'MCP_INSTALL_UNSAFE_INSTALL_ROOT:*' `
        -FailureMessage "Une racine non vide sans ownership a ete acceptee."
    if ((Get-Content -LiteralPath $ForeignSentinel -Raw).Trim() -ne 'must-survive') {
        throw 'La validation de racine a modifie un dossier etranger.'
    }

    & $InstallScript -InstallRoot $InstallRoot -SkipChecks

    foreach ($requiredPath in @(
        'app\catalog-migrations',
        'app\migrations',
        'app\history-migrations',
        'app\build\bootstrap\main.js',
        'config\application.docker.yml',
        'bin\mcp-search-net-catalog.cmd',
        'bin\mcp-search-net-maintain.cmd',
        'runtime\node-v24.18.0-win-x64\node.exe',
        'runtime\node-runtime-proof.json',
        'scripts\configure-install.ps1',
        'scripts\update-installation.ps1',
        'docker\compose.yaml',
        '.dockerignore',
        '.mcp-search-net-installation.json',
        'BUILD-MANIFEST.json'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $requiredPath))) {
            throw "Artefact de packaging installe absent : $requiredPath"
        }
    }

    foreach ($legacyDuplicate in @('src', 'migrations', 'catalog-migrations', 'history-migrations', 'package.json')) {
        if (Test-Path -LiteralPath (Join-Path $InstallRoot $legacyDuplicate)) {
            throw "Le layout source historique duplique encore un artefact programme a la racine : $legacyDuplicate"
        }
    }

    $McpExample = Get-Content -LiteralPath (Join-Path $InstallRoot 'mcp.json.example') -Raw | ConvertFrom-Json
    $McpServer = $McpExample.mcpServers.'mcp-search-net'
    if ($null -eq $McpServer -or
        $McpServer.type -ne 'local' -or
        $McpServer.command -ne 'cmd.exe' -or
        $McpServer.tools.Count -ne 1 -or
        $McpServer.tools[0] -ne '*' -or
        $McpServer.args[-1] -ne (Join-Path $InstallRoot 'bin\mcp-search-net.cmd') -or
        $McpServer.env.MCP_SEARCH_HOME -ne $InstallRoot -or
        $McpServer.env.MCP_CONFIG_PATH -ne (Join-Path $InstallRoot 'config\application.yml') -or
        $McpServer.env.MCP_CATALOG_PATH -ne (Join-Path $InstallRoot 'data\catalog.db')) {
        throw 'mcp.json.example ne respecte pas le contrat MCP local installe.'
    }

    $BuildManifest = Get-Content -LiteralPath (Join-Path $InstallRoot 'BUILD-MANIFEST.json') -Raw | ConvertFrom-Json
    $ExpectedVersion = (Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw | ConvertFrom-Json).version
    if ($BuildManifest.version -ne $ExpectedVersion -or
        $BuildManifest.nodeVersion -ne '24.18.0' -or
        $BuildManifest.sourceRevision -notmatch '^(?:[a-f0-9]{40}|UNAVAILABLE)$') {
        throw 'BUILD-MANIFEST.json ne decrit pas la version et la revision source.'
    }

    $RuntimeProof = Get-Content -LiteralPath (Join-Path $InstallRoot 'runtime\node-runtime-proof.json') -Raw | ConvertFrom-Json
    if ($RuntimeProof.nodeVersion -ne '24.18.0' -or
        $RuntimeProof.archiveVerifiedAtInstall -ne $true -or
        $RuntimeProof.archiveSha256 -ne '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821' -or
        $RuntimeProof.signatureStatus -ne 'Valid') {
        throw 'La preuve du runtime Node.js installe est invalide.'
    }

    & (Join-Path $InstallRoot 'bin\mcp-search-net-catalog.cmd') health
    if ($LASTEXITCODE -ne 0) {
        throw "Le launcher catalogue installe a echoue avec le code $LASTEXITCODE."
    }
    $InstalledNodeExe = Join-Path $InstallRoot 'runtime\node-v24.18.0-win-x64\node.exe'
    & $InstalledNodeExe (Join-Path $SourceRoot 'scripts\probe-installed-mcp.mjs') (Join-Path $InstallRoot 'bin\mcp-search-net.cmd') $InstallRoot
    if ($LASTEXITCODE -ne 0) {
        throw "La sonde MCP STDIO installee a echoue avec le code $LASTEXITCODE."
    }

    $Docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -ne $Docker) {
        & $Docker.Source compose --env-file (Join-Path $InstallRoot '.env') -p mcp-search-net-install-test -f (Join-Path $InstallRoot 'compose.yaml') --profile stdio config --quiet
        if ($LASTEXITCODE -ne 0) {
            throw "Le modele Compose installe est invalide (code $LASTEXITCODE)."
        }
    }

    $EnvironmentPath = Join-Path $InstallRoot '.env'
    $EnvironmentBeforeUpgrade = Get-Content -LiteralPath $EnvironmentPath -Raw
    if ($EnvironmentBeforeUpgrade -match 'replace-with|local-development-secret|mcp-search-local-development-token') {
        throw "L'installation propre a conserve un secret de developpement connu."
    }

    $AppRollbackMarker = Join-Path $InstallRoot 'app\rollback.marker'
    $BinRollbackMarker = Join-Path $InstallRoot 'bin\rollback.marker'
    $RuntimeRollbackMarker = Join-Path $InstallRoot 'runtime\rollback.marker'
    Set-Content -LiteralPath $AppRollbackMarker -Value 'previous-app'
    Set-Content -LiteralPath $BinRollbackMarker -Value 'previous-bin'
    Set-Content -LiteralPath $RuntimeRollbackMarker -Value 'previous-runtime'
    $ManifestBeforeFailedUpgrade = Get-Content -LiteralPath (Join-Path $InstallRoot 'BUILD-MANIFEST.json') -Raw

    Assert-ThrowsLike `
        -Action { & $InstallScript -InstallRoot $InstallRoot -SkipChecks -TestFailActivationAfterEntries 3 } `
        -Pattern 'MCP_UPDATE_TEST_ACTIVATION_FAILURE:3' `
        -FailureMessage "La recette transactionnelle n'a pas provoque l'echec attendu apres trois entrees."

    foreach ($marker in @($AppRollbackMarker, $BinRollbackMarker, $RuntimeRollbackMarker)) {
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
            throw "Le rollback transactionnel n'a pas restaure : $marker"
        }
    }
    if ((Get-Content -LiteralPath (Join-Path $InstallRoot 'BUILD-MANIFEST.json') -Raw) -cne $ManifestBeforeFailedUpgrade) {
        throw 'Le rollback transactionnel a laisse un manifeste partiellement mis a jour.'
    }
    foreach ($transactionPath in @('.install-staging', '.install-rollback')) {
        if (Test-Path -LiteralPath (Join-Path $InstallRoot $transactionPath)) {
            throw "Le rollback transactionnel a laisse un etat residuel : $transactionPath"
        }
    }

    $ConfigPath = Join-Path $InstallRoot 'config\application.yml'
    $DockerConfigPath = Join-Path $InstallRoot 'config\application.docker.yml'
    $DataRoot = Join-Path $InstallRoot 'data'
    New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
    $DataMarker = Join-Path $DataRoot 'preserve.marker'
    Add-Content -LiteralPath $ConfigPath -Value "`n# preserved-user-configuration"
    Add-Content -LiteralPath $DockerConfigPath -Value "`n# preserved-docker-configuration"
    Set-Content -LiteralPath $DataMarker -Value 'preserved-user-data'

    & $InstallScript -InstallRoot $InstallRoot -SkipChecks
    if ((Get-Content -LiteralPath $EnvironmentPath -Raw) -cne $EnvironmentBeforeUpgrade) {
        throw 'La reinstallation a remplace les secrets locaux generes.'
    }
    if (-not (Select-String -LiteralPath $ConfigPath -SimpleMatch 'preserved-user-configuration')) {
        throw 'La reinstallation a remplace la configuration utilisateur.'
    }
    if (-not (Select-String -LiteralPath $DockerConfigPath -SimpleMatch 'preserved-docker-configuration')) {
        throw 'La reinstallation a remplace la configuration Docker utilisateur.'
    }
    if (-not (Test-Path -LiteralPath $DataMarker)) {
        throw 'La reinstallation a supprime les donnees utilisateur.'
    }

    & $UninstallScript -InstallRoot $InstallRoot -SkipServices -Confirm:$false
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'config')) -or
        -not (Test-Path -LiteralPath $DataMarker) -or
        -not (Test-Path -LiteralPath (Join-Path $InstallRoot '.mcp-search-net-installation.json'))) {
        throw "La desinstallation par defaut n'a pas conserve configuration, donnees et ownership."
    }
    foreach ($removedProgramPath in @('app', 'bin', 'runtime', 'scripts', 'docker', 'BUILD-MANIFEST.json')) {
        if (Test-Path -LiteralPath (Join-Path $InstallRoot $removedProgramPath)) {
            throw "La desinstallation par defaut n'a pas supprime le programme : $removedProgramPath"
        }
    }

    & $InstallScript -InstallRoot $InstallRoot -SkipChecks
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'app\build\bootstrap\main.js') -PathType Leaf)) {
        throw 'La reinstallation apres conservation des donnees a echoue.'
    }

    & $UninstallScript -InstallRoot $InstallRoot -PurgeData -SkipServices -Confirm:$false
    if (Test-Path -LiteralPath $InstallRoot) {
        throw 'La desinstallation -PurgeData a laisse le dossier utilisateur.'
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
