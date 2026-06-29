[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-Native {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(ValueFromRemainingArguments)] [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "La commande '$FilePath' a échoué avec le code $LASTEXITCODE."
    }
}

Push-Location $RepositoryRoot
try {
    $Docker = Get-Command docker -ErrorAction Stop
    Invoke-Native $Docker.Source 'compose' 'up' '-d' '--wait' 'searxng' 'crawl4ai'
    Invoke-Native $Docker.Source 'compose' 'ps'
}
finally {
    Pop-Location
}
