[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptUnderTest = Join-Path $PSScriptRoot 'detect-integrations.ps1'
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ('mcp-client-preflight-' + [guid]::NewGuid().ToString('N'))
$InstallRoot = Join-Path $Root 'installed root'
$SandboxLocal = Join-Path $Root 'local'
$SandboxRoaming = Join-Path $Root 'roaming'
$SandboxUser = Join-Path $Root 'user'
$OriginalLocal = $env:LOCALAPPDATA
$OriginalRoaming = $env:APPDATA
$OriginalUser = $env:USERPROFILE
$OriginalPath = $env:PATH

function Read-IniSections([string] $Path) {
    $result = @{}
    $section = ''
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }
        if ($trimmed -match '^\[(.+)\]$') {
            $section = $matches[1]
            $result[$section] = @{}
            continue
        }
        $separator = $trimmed.IndexOf('=')
        if ($separator -gt 0 -and $section) {
            $result[$section][$trimmed.Substring(0, $separator)] = $trimmed.Substring($separator + 1)
        }
    }
    return $result
}

function Invoke-Detect([string] $Name) {
    $out = Join-Path $Root "$Name.ini"
    & $ScriptUnderTest -Mode Detect -InstallRoot $InstallRoot -Out $out
    if ($LASTEXITCODE -ne 0) { throw "Detect $Name a échoué : $LASTEXITCODE" }
    return Read-IniSections $out
}

function Assert-State([hashtable] $Ini, [string] $Section, [string] $State, [string] $Available, [string] $Integrated) {
    if (-not $Ini.ContainsKey($Section)) { throw "Section absente : $Section" }
    if ($Ini[$Section]['State'] -ne $State) { throw "$Section State attendu=$State obtenu=$($Ini[$Section]['State'])" }
    if ($Ini[$Section]['Available'] -ne $Available) { throw "$Section Available attendu=$Available obtenu=$($Ini[$Section]['Available'])" }
    if ($Ini[$Section]['AlreadyIntegrated'] -ne $Integrated) { throw "$Section AlreadyIntegrated attendu=$Integrated obtenu=$($Ini[$Section]['AlreadyIntegrated'])" }
}

function New-FakeExecutable([string] $Path, [string] $Body) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Path -Parent) | Out-Null
    [System.IO.File]::WriteAllText($Path, $Body, [System.Text.Encoding]::ASCII)
}

try {
    New-Item -ItemType Directory -Force -Path $InstallRoot, $SandboxLocal, $SandboxRoaming, $SandboxUser | Out-Null
    $env:LOCALAPPDATA = $SandboxLocal
    $env:APPDATA = $SandboxRoaming
    $env:USERPROFILE = $SandboxUser

    $absent = Invoke-Detect 'absent'
    foreach ($section in @('CopilotJetBrains', 'CopilotCli', 'ClaudeDesktop', 'ClaudeCode', 'CodexDesktop')) {
        Assert-State $absent $section 'Absent' '0' '0'
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $SandboxLocal 'github-copilot\intellij') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $SandboxRoaming 'Claude\logs') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $SandboxUser '.local\bin') | Out-Null
    New-FakeExecutable (Join-Path $SandboxUser '.local\bin\claude.exe') ''
    New-Item -ItemType Directory -Force -Path (Join-Path $SandboxUser '.codex') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $SandboxUser '.codex\config.toml'), "# test`r`n", [System.Text.Encoding]::UTF8)

    $fakeBin = Join-Path $Root 'bin'
    $copilotCmd = Join-Path $fakeBin 'copilot.cmd'
    New-FakeExecutable $copilotCmd '@echo off
exit /b 0
'
    $env:PATH = $fakeBin + ';' + $OriginalPath

    $missing = Invoke-Detect 'missing'
    foreach ($section in @('CopilotJetBrains', 'CopilotCli', 'ClaudeDesktop', 'ClaudeCode', 'CodexDesktop')) {
        Assert-State $missing $section 'Missing' '1' '0'
    }

    $clients = 'copilot-jetbrains,copilot-cli,claude-desktop,claude-code,codex'
    $log = Join-Path $Root 'apply.log'
    & $ScriptUnderTest -Mode Apply -InstallRoot $InstallRoot -Clients $clients -LogPath $log
    if ($LASTEXITCODE -ne 0) { throw "Apply initial a échoué : $LASTEXITCODE`n$(Get-Content $log -Raw)" }

    $integrated = Invoke-Detect 'integrated'
    foreach ($section in @('CopilotJetBrains', 'CopilotCli', 'ClaudeDesktop', 'ClaudeCode', 'CodexDesktop')) {
        Assert-State $integrated $section 'Integrated' '0' '1'
        if ($integrated[$section]['Reason'] -notmatch 'déjà intégré et conforme') {
            throw "$section n'affiche pas le statut déjà intégré : $($integrated[$section]['Reason'])"
        }
    }

    $desktopConfig = Join-Path $SandboxRoaming 'Claude\claude_desktop_config.json'
    $desktop = Get-Content -LiteralPath $desktopConfig -Raw | ConvertFrom-Json
    $desktop.mcpServers | Add-Member -NotePropertyName 'other-server' -NotePropertyValue ([PSCustomObject]@{ command = 'other.exe' }) -Force
    $desktop.mcpServers.'mcp-search-net'.env.MCP_CONFIG_PATH = 'C:\stale\application.yml'
    ($desktop | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $desktopConfig -Encoding UTF8

    $drift = Invoke-Detect 'drift'
    Assert-State $drift 'ClaudeDesktop' 'Drift' '1' '0'
    if ($drift['ClaudeDesktop']['Reason'] -notmatch 'configuration différente') {
        throw "ClaudeDesktop drift non explicite : $($drift['ClaudeDesktop']['Reason'])"
    }

    & $ScriptUnderTest -Mode Apply -InstallRoot $InstallRoot -Clients 'claude-desktop' -LogPath $log
    if ($LASTEXITCODE -ne 0) { throw "Réparation Claude Desktop a échoué : $LASTEXITCODE`n$(Get-Content $log -Raw)" }

    $repaired = Invoke-Detect 'repaired'
    Assert-State $repaired 'ClaudeDesktop' 'Integrated' '0' '1'
    $desktopAfter = Get-Content -LiteralPath $desktopConfig -Raw | ConvertFrom-Json
    if ($null -eq $desktopAfter.mcpServers.'other-server') { throw 'La réparation a supprimé un serveur MCP non concerné.' }

    $metadata = Get-Content -LiteralPath (Join-Path $InstallRoot 'mcp-client-integrations.json') -Raw | ConvertFrom-Json
    foreach ($key in @(
        'copilot-jetbrains:mcp-search-net',
        'copilot-cli:mcp-search-net',
        'claude-desktop:mcp-search-net',
        'claude-code:mcp-search-net',
        'codex:mcp-search-net'
    )) {
        if ($null -eq ($metadata.PSObject.Properties | Where-Object Name -eq $key | Select-Object -First 1)) {
            throw "Métadonnée d'ownership absente : $key"
        }
    }

    Write-Host 'WINDOWS_CLIENT_INTEGRATION_PREFLIGHT_PASS'
}
finally {
    $env:LOCALAPPDATA = $OriginalLocal
    $env:APPDATA = $OriginalRoaming
    $env:USERPROFILE = $OriginalUser
    $env:PATH = $OriginalPath
    Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
}
