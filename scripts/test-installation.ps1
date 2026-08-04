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
$RuntimeRoot = Join-Path $InstallRoot 'runtime\node-v24.18.0-win-x64'

try {
    New-Item -ItemType Directory -Force -Path $SourceRoot | Out-Null
    $ExcludedSourceEntries = @('.git', 'node_modules', 'build', 'coverage', '.data')
    foreach ($entry in Get-ChildItem -LiteralPath $RepositoryRoot -Force) {
        if ($ExcludedSourceEntries -notcontains $entry.Name) {
            Copy-Item -LiteralPath $entry.FullName -Destination $SourceRoot -Recurse -Force
        }
    }
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Copy-Item -Path (Join-Path $NodeRuntimeSource '*') -Destination $RuntimeRoot -Recurse -Force

    & (Join-Path $SourceRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks

    foreach ($requiredPath in @(
        'catalog-migrations',
        'migrations',
        'config\application.docker.yml',
        'bin\mcp-search-net-catalog.cmd',
        'bin\mcp-search-net-maintain.cmd',
        '.dockerignore',
        'BUILD-MANIFEST.json'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $requiredPath))) {
            throw "Artefact de packaging installé absent : $requiredPath"
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
        $McpServer.env.MCP_SEARCH_HOME -ne $InstallRoot) {
        throw 'mcp.json.example ne respecte pas le contrat Copilot local mcpServers.'
    }

    $BuildManifest = Get-Content -LiteralPath (Join-Path $InstallRoot 'BUILD-MANIFEST.json') -Raw | ConvertFrom-Json
    $ExpectedVersion = (Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw | ConvertFrom-Json).version
    if ($BuildManifest.version -ne $ExpectedVersion -or
        $BuildManifest.nodeVersion -ne '24.18.0' -or
        $BuildManifest.sourceRevision -notmatch '^(?:[a-f0-9]{40}|UNAVAILABLE)$' -or
        $BuildManifest.sourceState -notin @('CLEAN', 'DIRTY', 'REVISION_UNVERIFIED', 'CI_UNVERIFIED', 'UNAVAILABLE')) {
        throw 'BUILD-MANIFEST.json ne décrit pas la version et la révision source.'
    }

    & (Join-Path $InstallRoot 'bin\mcp-search-net-catalog.cmd') health
    if ($LASTEXITCODE -ne 0) {
        throw "Le launcher catalogue installé a échoué avec le code $LASTEXITCODE."
    }
    $InstalledNodeExe = Join-Path $RuntimeRoot 'node.exe'
    & $InstalledNodeExe (Join-Path $SourceRoot 'scripts\probe-installed-mcp.mjs') (Join-Path $InstallRoot 'bin\mcp-search-net.cmd') $InstallRoot
    if ($LASTEXITCODE -ne 0) {
        throw "La sonde MCP STDIO installée a échoué avec le code $LASTEXITCODE."
    }

    $Docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -ne $Docker) {
        & $Docker.Source compose --env-file (Join-Path $InstallRoot '.env') -p mcp-search-net-install-test -f (Join-Path $InstallRoot 'compose.yaml') --profile stdio config --quiet
        if ($LASTEXITCODE -ne 0) {
            throw "Le modèle Compose installé est invalide (code $LASTEXITCODE)."
        }
    }

    $EnvironmentPath = Join-Path $InstallRoot '.env'
    $EnvironmentBeforeUpgrade = Get-Content -LiteralPath $EnvironmentPath -Raw
    if ($EnvironmentBeforeUpgrade -match 'replace-with|local-development-secret|mcp-search-local-development-token') {
        throw "L'installation propre a conservé un secret de développement connu."
    }

    $RollbackMarker = Join-Path $InstallRoot 'app\rollback.marker'
    Set-Content -LiteralPath $RollbackMarker -Value 'previous-installation'
    $RollbackFailureObserved = $false
    try {
        & (Join-Path $SourceRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks -TestFailActivation
    }
    catch {
        $RollbackFailureObserved = $true
    }
    if (-not $RollbackFailureObserved) {
        throw "La recette de rollback n'a pas provoqué l'échec d'activation attendu."
    }
    if (-not (Test-Path -LiteralPath $RollbackMarker -PathType Leaf)) {
        throw "Le rollback d'activation n'a pas restauré l'ancienne application."
    }
    $PreviousApplications = @(Get-ChildItem -LiteralPath $InstallRoot -Directory -Filter 'app.previous-*' -ErrorAction SilentlyContinue)
    if ($PreviousApplications.Count -ne 0) {
        throw "Le rollback d'activation a laissé une ancienne application détachée."
    }

    $ConfigPath = Join-Path $InstallRoot 'config\application.yml'
    $DockerConfigPath = Join-Path $InstallRoot 'config\application.docker.yml'
    $DataMarker = Join-Path $InstallRoot 'data\preserve.marker'
    Add-Content -LiteralPath $ConfigPath -Value "`n# preserved-user-configuration"
    Add-Content -LiteralPath $DockerConfigPath -Value "`n# preserved-docker-configuration"
    Set-Content -LiteralPath $DataMarker -Value 'preserved-user-data'

    & (Join-Path $SourceRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks
    if ((Get-Content -LiteralPath $EnvironmentPath -Raw) -cne $EnvironmentBeforeUpgrade) {
        throw 'La réinstallation a remplacé les secrets locaux générés.'
    }
    if (-not (Select-String -LiteralPath $ConfigPath -SimpleMatch 'preserved-user-configuration')) {
        throw 'La réinstallation a remplacé la configuration utilisateur.'
    }
    if (-not (Select-String -LiteralPath $DockerConfigPath -SimpleMatch 'preserved-docker-configuration')) {
        throw 'La réinstallation a remplacé la configuration Docker utilisateur.'
    }
    if (-not (Test-Path -LiteralPath $DataMarker)) {
        throw 'La réinstallation a supprimé les données utilisateur.'
    }

    & (Join-Path $SourceRoot 'scripts\uninstall-user.ps1') -InstallRoot $InstallRoot -KeepData -SkipServices -Confirm:$false
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'config')) -or -not (Test-Path -LiteralPath $DataMarker)) {
        throw "La désinstallation -KeepData n'a pas conservé configuration et données."
    }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'app')) {
        throw "La désinstallation -KeepData n'a pas supprimé le programme."
    }

    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Copy-Item -Path (Join-Path $NodeRuntimeSource '*') -Destination $RuntimeRoot -Recurse -Force
    & (Join-Path $SourceRoot 'scripts\install-user.ps1') -InstallRoot $InstallRoot -SkipChecks
    & (Join-Path $SourceRoot 'scripts\uninstall-user.ps1') -InstallRoot $InstallRoot -SkipServices -Confirm:$false
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
