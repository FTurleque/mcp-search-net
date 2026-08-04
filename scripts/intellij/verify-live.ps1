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
    $Npm = Get-Command npm -ErrorAction Stop
    $Docker = Get-Command docker -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($env:CRAWL4AI_API_TOKEN)) {
        $EnvironmentPath = Join-Path $RepositoryRoot '.env'
        if (Test-Path -LiteralPath $EnvironmentPath -PathType Leaf) {
            $TokenLine = Get-Content -LiteralPath $EnvironmentPath |
                Where-Object { $_.StartsWith('CRAWL4AI_API_TOKEN=', [System.StringComparison]::Ordinal) } |
                Select-Object -First 1
            if (-not [string]::IsNullOrWhiteSpace($TokenLine)) {
                $env:CRAWL4AI_API_TOKEN = $TokenLine.Substring('CRAWL4AI_API_TOKEN='.Length)
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:CRAWL4AI_API_TOKEN)) {
        throw 'CRAWL4AI_API_TOKEN est absent. Renseignez-le dans .env avant la recette live.'
    }
    Invoke-Native $Docker.Source 'compose' '-f' 'compose.yaml' '-f' 'compose.hybrid.yaml' 'up' '-d' '--wait' 'searxng' 'crawl4ai'
    Invoke-Native $Npm.Source 'run' 'build'
    Invoke-Native $Npm.Source 'run' 'test:e2e:live'
}
finally {
    Pop-Location
}
