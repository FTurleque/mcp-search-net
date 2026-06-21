[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch]$StartServices,
    [switch]$RunAfterInstall,
    [switch]$SkipChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NodeVersion = '24.17.0'
$NodeFolderName = "node-v$NodeVersion-win-x64"
$NodeArchiveName = "$NodeFolderName.zip"
$NodeDownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchiveName"
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)

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

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA est introuvable. Ce programme nécessite un profil utilisateur Windows.'
}

Write-Host "Installation de mcp-search-net dans $InstallRoot"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$NodeRoot = Join-Path $RuntimeRoot $NodeFolderName
$NodeExe = Join-Path $NodeRoot 'node.exe'
$NpmCmd = Join-Path $NodeRoot 'npm.cmd'

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    $archivePath = Join-Path $RuntimeRoot $NodeArchiveName
    Write-Host "Téléchargement de Node.js $NodeVersion LTS depuis nodejs.org..."
    Invoke-WebRequest -Uri $NodeDownloadUrl -OutFile $archivePath -UseBasicParsing
    Expand-Archive -LiteralPath $archivePath -DestinationPath $RuntimeRoot -Force
    Remove-Item -LiteralPath $archivePath -Force
}

if (-not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) {
    throw "Runtime Node.js incomplet : $NpmCmd est absent."
}

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
if (Test-Path -LiteralPath $StageRoot) {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $StageApp | Out-Null

Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'dist') -Destination $StageApp -Recurse
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Destination $StageApp
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package-lock.json') -Destination $StageApp

Push-Location $StageApp
try {
    Write-Host 'Installation des seules dépendances de production...'
    Invoke-NativeCommand $NpmCmd 'ci' '--omit=dev' '--ignore-scripts=false'
}
finally {
    Pop-Location
}

$AppRoot = Join-Path $InstallRoot 'app'
Assert-PathInsideInstallRoot $AppRoot
if (Test-Path -LiteralPath $AppRoot) {
    Remove-Item -LiteralPath $AppRoot -Recurse -Force
}
Move-Item -LiteralPath $StageApp -Destination $AppRoot
Remove-Item -LiteralPath $StageRoot -Force

$ConfigRoot = Join-Path $InstallRoot 'config'
$SearxConfigRoot = Join-Path $ConfigRoot 'searxng'
$DataRoot = Join-Path $InstallRoot 'data'
$BinRoot = Join-Path $InstallRoot 'bin'
New-Item -ItemType Directory -Force -Path $ConfigRoot, $SearxConfigRoot, $DataRoot, $BinRoot | Out-Null

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

Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'compose.yaml') -Destination (Join-Path $InstallRoot 'compose.yaml') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'compose.hybrid.yaml') -Destination (Join-Path $InstallRoot 'compose.hybrid.yaml') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'Dockerfile') -Destination (Join-Path $InstallRoot 'Dockerfile') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Destination (Join-Path $InstallRoot 'package.json') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'package-lock.json') -Destination (Join-Path $InstallRoot 'package-lock.json') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'tsconfig.json') -Destination (Join-Path $InstallRoot 'tsconfig.json') -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'tsconfig.build.json') -Destination (Join-Path $InstallRoot 'tsconfig.build.json') -Force
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

$InstalledDocs = Join-Path $InstallRoot 'docs'
Assert-PathInsideInstallRoot $InstalledDocs
if (Test-Path -LiteralPath $InstalledDocs) {
    Remove-Item -LiteralPath $InstalledDocs -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'docs') -Destination $InstalledDocs -Recurse

$Package = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Raw | ConvertFrom-Json
$Utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $InstallRoot 'VERSION'), "$($Package.version)`r`n", $Utf8WithoutBom)

$Launcher = Join-Path $BinRoot 'mcp-search-net.cmd'
$McpExample = [ordered]@{
    servers = [ordered]@{
        'mcp-search-net' = [ordered]@{
            command = 'cmd.exe'
            args = @('/d', '/s', '/c', "`"$Launcher`"")
            env = [ordered]@{
                MCP_SEARCH_HOME = $InstallRoot
            }
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
    servers = [ordered]@{
        'mcp-search-net-container' = [ordered]@{
            command = 'cmd.exe'
            args = @('/d', '/s', '/c', "`"$ContainerLauncher`"")
            env = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
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
    Write-Host 'Démarrage de SearXNG et Crawl4AI...'
    Invoke-NativeCommand $Docker.Source 'compose' '-p' 'mcp-search-net-user' '-f' (Join-Path $InstallRoot 'compose.yaml') '-f' (Join-Path $InstallRoot 'compose.hybrid.yaml') 'up' '-d' '--wait' 'searxng' 'crawl4ai'
}

if ($RunAfterInstall) {
    Write-Host 'Démarrage du serveur MCP STDIO (arrêter avec Ctrl+C)...'
    & $Launcher
    exit $LASTEXITCODE
}
