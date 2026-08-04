[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$StartServices
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Write-Diagnostic {
    param([Parameter(Mandatory)] [string]$Message)
    [Console]::Error.WriteLine($Message)
}

function Invoke-NativeToStderr {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(ValueFromRemainingArguments)] [string[]]$Arguments
    )

    $Output = & $FilePath @Arguments 2>&1
    $ExitCode = $LASTEXITCODE
    foreach ($Line in $Output) {
        [Console]::Error.WriteLine([string]$Line)
    }
    if ($ExitCode -ne 0) {
        throw "La commande '$FilePath' a échoué avec le code $ExitCode."
    }
}

Push-Location $RepositoryRoot
try {
    $Node = Get-Command node -ErrorAction Stop
    $Npm = Get-Command npm -ErrorAction Stop
    $NodeVersion = (& $Node.Source --version).Trim()
    if ($NodeVersion -notmatch '^v24\.') {
        throw "Node.js 24 est requis pour lancer le MCP. Version détectée : $NodeVersion"
    }

    if (-not $SkipBuild) {
        Write-Diagnostic 'Build TypeScript avant lancement MCP...'
        Invoke-NativeToStderr $Npm.Source 'run' 'build'
    }

    if ($StartServices) {
        $Docker = Get-Command docker -ErrorAction Stop
        Write-Diagnostic 'Démarrage de SearXNG et Crawl4AI via Docker Compose...'
        Invoke-NativeToStderr $Docker.Source 'compose' '-f' 'compose.yaml' '-f' 'compose.hybrid.yaml' 'up' '-d' '--wait' 'searxng' 'crawl4ai'
    }

    $env:MCP_CONFIG_PATH = Join-Path $RepositoryRoot 'config\application.yml'
    if ([string]::IsNullOrWhiteSpace($env:MCP_CRAWL4AI_TOKEN)) {
        $EnvironmentPath = Join-Path $RepositoryRoot '.env'
        if (Test-Path -LiteralPath $EnvironmentPath -PathType Leaf) {
            $TokenLine = Get-Content -LiteralPath $EnvironmentPath |
                Where-Object { $_.StartsWith('CRAWL4AI_API_TOKEN=', [System.StringComparison]::Ordinal) } |
                Select-Object -First 1
            if (-not [string]::IsNullOrWhiteSpace($TokenLine)) {
                $env:MCP_CRAWL4AI_TOKEN = $TokenLine.Substring('CRAWL4AI_API_TOKEN='.Length)
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:MCP_CRAWL4AI_TOKEN)) {
        throw 'MCP_CRAWL4AI_TOKEN est absent. Définissez-le ou renseignez CRAWL4AI_API_TOKEN dans .env.'
    }
    $env:MCP_CACHE_PATH = Join-Path $RepositoryRoot '.data\intellij-cache.sqlite'

    & $Node.Source (Join-Path $RepositoryRoot 'build\bootstrap\main.js')
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
