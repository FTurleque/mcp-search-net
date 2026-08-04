[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

Push-Location $RepositoryRoot
try {
    $Docker = Get-Command docker -ErrorAction Stop
    & $Docker.Source 'compose' '-f' 'compose.yaml' '-f' 'compose.hybrid.yaml' 'down'
    if ($LASTEXITCODE -ne 0) {
        throw "La commande '$($Docker.Source) compose down' a échoué avec le code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
