[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch]$KeepData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$ExpectedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'mcp-search-net'))

if (-not $InstallRoot.Equals($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Désinstallation refusée hors de l'emplacement attendu : $ExpectedRoot"
}

if (-not (Test-Path -LiteralPath $InstallRoot)) {
    Write-Host 'mcp-search-net n’est pas installé pour cet utilisateur.'
    exit 0
}

$Docker = Get-Command docker -ErrorAction SilentlyContinue
$ComposeFile = Join-Path $InstallRoot 'compose.yaml'
if (($null -ne $Docker) -and (Test-Path -LiteralPath $ComposeFile)) {
    & $Docker.Source compose -f $ComposeFile down
}

if ($KeepData) {
    foreach ($name in @('app', 'bin', 'docs', 'runtime', 'compose.yaml', '.env.example', 'mcp.json.example', 'VERSION')) {
        $target = Join-Path $InstallRoot $name
        if ((Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target, 'Supprimer')) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    Write-Host "Programme supprimé. Configuration et données conservées dans $InstallRoot."
}
elseif ($PSCmdlet.ShouldProcess($InstallRoot, 'Supprimer entièrement')) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    Write-Host 'mcp-search-net a été désinstallé pour cet utilisateur.'
}
