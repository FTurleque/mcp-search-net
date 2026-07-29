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
        if (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf) {
            & $Docker.Source compose --env-file $EnvironmentFile -p $project -f $ComposeFile down
        }
        elseif (Test-Path -LiteralPath $EnvironmentExampleFile -PathType Leaf) {
            & $Docker.Source compose --env-file $EnvironmentExampleFile -p $project -f $ComposeFile down
        }
        else {
            & $Docker.Source compose -p $project -f $ComposeFile down
        }
        if ($LASTEXITCODE -ne 0) {
            throw "La commande '$($Docker.Source)' a échoué avec le code $LASTEXITCODE."
        }
    }
}

if ($KeepData) {
    foreach ($name in @('app', 'bin', 'docs', 'runtime', 'src', 'compose.yaml', 'compose.hybrid.yaml', 'Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', '.env.example', 'mcp.json.example', 'mcp.container.json.example', 'VERSION')) {
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
