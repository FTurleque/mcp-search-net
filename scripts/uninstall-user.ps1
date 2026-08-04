[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch]$KeepData,
    [switch]$SkipServices
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$ExpectedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'mcp-search-net'))

if (-not $InstallRoot.Equals($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Désinstallation refusée hors de l'emplacement attendu : $ExpectedRoot"
}

if (-not (Test-Path -LiteralPath $InstallRoot)) {
    Write-Host "mcp-search-net n'est pas installé pour cet utilisateur."
    exit 0
}

$Docker = Get-Command docker -ErrorAction SilentlyContinue
$ComposeFile = Join-Path $InstallRoot 'compose.yaml'
$ComposeHybridFile = Join-Path $InstallRoot 'compose.hybrid.yaml'
$EnvironmentFile = Join-Path $InstallRoot '.env'
$EnvironmentExampleFile = Join-Path $InstallRoot '.env.example'
if ((-not $SkipServices) -and ($null -ne $Docker) -and (Test-Path -LiteralPath $ComposeFile)) {
    $ComposeProject = if ([string]::IsNullOrWhiteSpace($env:MCP_SEARCH_COMPOSE_PROJECT)) {
        'mcp-search-net'
    }
    else {
        $env:MCP_SEARCH_COMPOSE_PROJECT
    }
    foreach ($project in @($ComposeProject, 'mcp-search-net-user') | Select-Object -Unique) {
        $DownArguments = @('compose')
        if (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf) {
            $DownArguments += @('--env-file', $EnvironmentFile)
        }
        elseif (Test-Path -LiteralPath $EnvironmentExampleFile -PathType Leaf) {
            $DownArguments += @('--env-file', $EnvironmentExampleFile)
        }
        $DownArguments += @('-p', $project, '-f', $ComposeFile)
        if (Test-Path -LiteralPath $ComposeHybridFile -PathType Leaf) {
            $DownArguments += @('-f', $ComposeHybridFile)
        }
        $DownArguments += 'down'
        if (-not $KeepData) {
            $DownArguments += '--volumes'
        }
        $ComposeAction = if ($KeepData) { 'Arrêter les services Compose' } else { 'Arrêter les services Compose et supprimer leurs volumes' }
        if ($PSCmdlet.ShouldProcess("projet Compose $project", $ComposeAction)) {
            & $Docker.Source @DownArguments
            if ($LASTEXITCODE -ne 0) {
                throw "La commande '$($Docker.Source)' a échoué avec le code $LASTEXITCODE."
            }
        }
    }
}

if ($KeepData) {
    foreach ($name in @('app', 'bin', 'docs', 'runtime', 'src', 'migrations', 'catalog-migrations', 'compose.yaml', 'compose.hybrid.yaml', 'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', '.env.example', 'mcp.json.example', 'mcp.container.json.example', 'VERSION', 'BUILD-MANIFEST.json')) {
        $target = Join-Path $InstallRoot $name
        if ((Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target, 'Supprimer')) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    Write-Host "Programme supprimé. Configuration et données conservées dans $InstallRoot."
}
elseif ($PSCmdlet.ShouldProcess($InstallRoot, 'Supprimer entièrement')) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    Write-Host "mcp-search-net a été désinstallé pour cet utilisateur."
}
