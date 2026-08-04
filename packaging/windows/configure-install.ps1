[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallRoot,
    [switch] $SmokeMode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

$EnvFile = Join-Path $InstallRoot '.env'
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    $crawl4aiToken = New-LocalSecret
    $searxngSecret = New-LocalSecret
    $envContent = @(
        '# Secrets générés localement par l''installateur. Ne pas commiter ce fichier.'
        "CRAWL4AI_API_TOKEN=$crawl4aiToken"
        "MCP_CRAWL4AI_TOKEN=$crawl4aiToken"
        "SEARXNG_SECRET=$searxngSecret"
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($EnvFile, $envContent + "`r`n", $Utf8NoBom)
    Write-Host "Secrets fournisseurs locaux générés : $EnvFile"
}

if ($SmokeMode) { exit 0 }

$BinLauncher = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$ContainerLauncher = Join-Path $InstallRoot 'bin\mcp-search-net-container.cmd'

$McpExample = [ordered]@{
    mcpServers = [ordered]@{
        'mcp-search-net' = [ordered]@{
            type    = 'local'
            command = 'cmd.exe'
            args    = @('/d', '/s', '/c', $BinLauncher)
            env     = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
            tools   = @('*')
        }
    }
}
[System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'mcp.json.example'),
    (($McpExample | ConvertTo-Json -Depth 5) + "`r`n"),
    $Utf8NoBom
)

$ContainerExample = [ordered]@{
    mcpServers = [ordered]@{
        'mcp-search-net-container' = [ordered]@{
            type    = 'local'
            command = 'cmd.exe'
            args    = @('/d', '/s', '/c', $ContainerLauncher)
            env     = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
            tools   = @('*')
        }
    }
}
[System.IO.File]::WriteAllText(
    (Join-Path $InstallRoot 'mcp.container.json.example'),
    (($ContainerExample | ConvertTo-Json -Depth 5) + "`r`n"),
    $Utf8NoBom
)

Write-Host "Configuration post-installation terminée : $InstallRoot"
Write-Host "Exemple MCP Copilot : $(Join-Path $InstallRoot 'mcp.json.example')"
