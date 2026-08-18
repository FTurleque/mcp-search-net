[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch]$KeepData,
    [switch]$PurgeData,
    [switch]$SkipServices,
    [switch]$AllowCustomInstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA est introuvable. Ce programme necessite un profil utilisateur Windows.'
}
if ($KeepData -and $PurgeData) {
    throw 'KeepData et PurgeData sont mutuellement exclusifs.'
}

$ManagedApplicationName = 'mcp-search-net'
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$DefaultInstallRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'mcp-search-net'))
$DeleteData = [bool]$PurgeData

function Test-SamePath {
    param(
        [Parameter(Mandatory)] [string]$Left,
        [Parameter(Mandatory)] [string]$Right
    )
    $trimChars = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd($trimChars)
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd($trimChars)
    return $leftFull.Equals($rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-OwnershipMarker {
    $markerPath = Join-Path $InstallRoot '.mcp-search-net-installation.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $false }
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.schemaVersion -ne '1.0' -or [string]$marker.name -ne $ManagedApplicationName) {
            return $false
        }
        $null = [guid]::Parse([string]$marker.installationId)
        return $true
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

function Assert-OwnedInstallRoot {
    if (-not (Test-SamePath -Left $InstallRoot -Right $DefaultInstallRoot) -and -not $AllowCustomInstallRoot) {
        throw "MCP_UNINSTALL_CUSTOM_ROOT_REQUIRES_OPT_IN: utilisez -AllowCustomInstallRoot pour '$InstallRoot'."
    }
    if (-not (Test-Path -LiteralPath $InstallRoot)) { return }
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
        throw "MCP_UNINSTALL_UNSAFE_INSTALL_ROOT: le chemin existe mais n'est pas un dossier : $InstallRoot"
    }
    $rootItem = Get-Item -LiteralPath $InstallRoot -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "MCP_UNINSTALL_UNSAFE_INSTALL_ROOT: racine de type reparse point refusee : $InstallRoot"
    }
    if (-not (Test-OwnershipMarker) -and -not (Test-LegacyOwnedInstallation)) {
        throw "MCP_UNINSTALL_UNSAFE_INSTALL_ROOT: aucune preuve d'ownership mcp-search-net dans $InstallRoot"
    }
}

function Assert-ManagedTargetSafe {
    param([Parameter(Mandatory)] [string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "MCP_UNINSTALL_REPARSE_POINT: chemin gere de type reparse point refuse : $Path"
    }
}

Assert-OwnedInstallRoot
if (-not (Test-Path -LiteralPath $InstallRoot)) {
    Write-Host "mcp-search-net n'est pas installe pour cet utilisateur."
    exit 0
}

$Docker = Get-Command docker -ErrorAction SilentlyContinue
$ComposeFile = Join-Path $InstallRoot 'compose.yaml'
$ComposeHybridFile = Join-Path $InstallRoot 'compose.hybrid.yaml'
$EnvironmentFile = Join-Path $InstallRoot '.env'
$EnvironmentExampleFile = Join-Path $InstallRoot '.env.example'
if ((-not $SkipServices) -and ($null -ne $Docker) -and (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
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
        if ($DeleteData) { $DownArguments += '--volumes' }
        $ComposeAction = if ($DeleteData) {
            'Arreter les services Compose et supprimer leurs volumes'
        }
        else {
            'Arreter les services Compose'
        }
        if ($PSCmdlet.ShouldProcess("projet Compose $project", $ComposeAction)) {
            & $Docker.Source @DownArguments
            if ($LASTEXITCODE -ne 0) {
                throw "La commande '$($Docker.Source)' a echoue avec le code $LASTEXITCODE."
            }
        }
    }
}

if ($DeleteData) {
    if ($PSCmdlet.ShouldProcess($InstallRoot, 'Supprimer entierement')) {
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force
        Write-Host 'mcp-search-net et ses donnees ont ete desinstalles pour cet utilisateur.'
    }
    exit 0
}

$ManagedProgramEntries = @(
    'app',
    'bin',
    'runtime',
    'scripts',
    'docker',
    'docs',
    'src',
    'migrations',
    'catalog-migrations',
    'history-migrations',
    'compose.yaml',
    'compose.hybrid.yaml',
    'Dockerfile',
    '.dockerignore',
    '.npmrc',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
    '.env.example',
    'mcp.json.example',
    'mcp.container.json.example',
    'VERSION',
    'BUILD-MANIFEST.json',
    'LICENSE',
    'THIRD-PARTY-NOTICES.txt'
)

foreach ($name in $ManagedProgramEntries) {
    $target = Join-Path $InstallRoot $name
    Assert-ManagedTargetSafe -Path $target
    if ((Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target, 'Supprimer')) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

# Keep the ownership marker while config/data are retained. A later reinstall into this non-empty
# persistent root can therefore prove that the directory belongs to mcp-search-net.
Write-Host "Programme supprime. Configuration, donnees et preuve d'ownership conservees dans $InstallRoot."
