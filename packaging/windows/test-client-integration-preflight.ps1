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

$GlobalPolicyBeginMark = '<!-- BEGIN MCP-SEARCH-NET GLOBAL POLICY -->'
$GlobalPolicyEndMark = '<!-- END MCP-SEARCH-NET GLOBAL POLICY -->'

function Assert-GlobalPolicyPresent([string] $Path, [string] $Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label : politique globale absente -> $Path" }
    $text = Get-Content -LiteralPath $Path -Raw
    if ($text -notlike "*$GlobalPolicyBeginMark*" -or $text -notlike "*$GlobalPolicyEndMark*") {
        throw "$Label : marqueurs de politique globale absents -> $Path"
    }
}

try {
    New-Item -ItemType Directory -Force -Path $InstallRoot, $SandboxLocal, $SandboxRoaming, $SandboxUser | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'scripts') | Out-Null
    [System.IO.File]::WriteAllText(
        (Join-Path $InstallRoot 'scripts\mcp-search-net-global-policy.md'),
        "## mcp-search-net`n`nUse mcp-search-net for external retrieval when relevant.`n",
        [System.Text.Encoding]::UTF8)
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
    New-FakeExecutable $copilotCmd "@echo off`r`nexit /b 0`r`n"
    $env:PATH = $fakeBin + ';' + $OriginalPath

    $missing = Invoke-Detect 'missing'
    foreach ($section in @('CopilotJetBrains', 'CopilotCli', 'ClaudeDesktop', 'ClaudeCode', 'CodexDesktop')) {
        Assert-State $missing $section 'Missing' '1' '0'
    }

    # Regression: a broken "copilot" shim earlier on PATH (observed in the wild -- an editor
    # extension shipping its own copilot.ps1 proxy that references PowerShell 6+ automatic
    # variables such as $IsWindows, unavailable under Windows PowerShell 5.1 + StrictMode) must
    # not make a perfectly working CLI further down PATH look uninstalled.
    $brokenShimDir = Join-Path $Root 'broken-copilot-shim'
    New-FakeExecutable (Join-Path $brokenShimDir 'copilot.ps1') '$IsWindows | Out-Null'
    $pathWithBrokenShim = $brokenShimDir + ';' + $env:PATH
    $previousPath = $env:PATH
    $env:PATH = $pathWithBrokenShim
    try {
        $shimmed = Invoke-Detect 'copilot-shim-regression'
        Assert-State $shimmed 'CopilotCli' 'Missing' '1' '0'
    }
    finally {
        $env:PATH = $previousPath
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

    # --- Global agent policy: applied by this real script, alongside MCP registration ---
    $claudeCodePolicy = Join-Path $SandboxUser '.claude\CLAUDE.md'
    $codexPolicy = Join-Path $SandboxUser '.codex\AGENTS.md'
    $copilotCliPolicy = Join-Path $SandboxUser '.copilot\copilot-instructions.md'
    $jetBrainsPolicy = Join-Path $SandboxLocal 'github-copilot\intellij\global-copilot-instructions.md'

    Assert-GlobalPolicyPresent $claudeCodePolicy 'Claude Code'
    Assert-GlobalPolicyPresent $codexPolicy 'Codex'
    Assert-GlobalPolicyPresent $copilotCliPolicy 'Copilot CLI'
    Assert-GlobalPolicyPresent $jetBrainsPolicy 'Copilot JetBrains'
    if (Test-Path -LiteralPath (Join-Path $SandboxRoaming 'Claude\global-copilot-instructions.md')) {
        throw 'Claude Desktop ne doit jamais recevoir de politique globale.'
    }

    foreach ($key in @('copilot-jetbrains:global-policy', 'copilot-cli:global-policy', 'claude-code:global-policy', 'codex:global-policy')) {
        $afterPolicyMetadata = Get-Content -LiteralPath (Join-Path $InstallRoot 'mcp-client-integrations.json') -Raw | ConvertFrom-Json
        if ($null -eq ($afterPolicyMetadata.PSObject.Properties | Where-Object Name -eq $key | Select-Object -First 1)) {
            throw "Métadonnée d'ownership de politique globale absente : $key"
        }
    }

    # Regression test for the exact bug this preflight was missing: on a real upgrade, the
    # wizard only offers (and Apply only touches) clients whose MCP entry is Missing/Drift —
    # a client whose MCP registration is already Integrated must still be offered, and still
    # get the policy applied, if the policy itself was never written (e.g. upgrading from a
    # version shipped before this feature existed).
    Remove-Item -LiteralPath $codexPolicy -Force

    $policyPending = Invoke-Detect 'policy-pending'
    Assert-State $policyPending 'CodexDesktop' 'Integrated' '1' '1'
    if ($policyPending['CodexDesktop']['Reason'] -notmatch 'politique globale') {
        throw "CodexDesktop n'indique pas que la politique globale reste à ajouter : $($policyPending['CodexDesktop']['Reason'])"
    }

    & $ScriptUnderTest -Mode Apply -InstallRoot $InstallRoot -Clients 'codex' -LogPath $log
    if ($LASTEXITCODE -ne 0) { throw "Rattrapage de la politique globale Codex a échoué : $LASTEXITCODE`n$(Get-Content $log -Raw)" }
    Assert-GlobalPolicyPresent $codexPolicy 'Codex (rattrapage)'
    $codexMcpAfterCatchUp = Get-Content -LiteralPath (Join-Path $SandboxUser '.codex\config.toml') -Raw
    if ($codexMcpAfterCatchUp -notmatch '\[mcp_servers\.mcp-search-net\]') {
        throw 'Le rattrapage de la politique globale a corrompu l''enregistrement MCP Codex existant.'
    }

    $policyCaughtUp = Invoke-Detect 'policy-caught-up'
    Assert-State $policyCaughtUp 'CodexDesktop' 'Integrated' '0' '1'

    # Idempotent: re-applying with everything current is a no-op (byte-identical file).
    $codexPolicyBefore = Get-Content -LiteralPath $codexPolicy -Raw
    & $ScriptUnderTest -Mode Apply -InstallRoot $InstallRoot -Clients 'codex' -LogPath $log
    if ($LASTEXITCODE -ne 0) { throw "Ré-application idempotente Codex a échoué : $LASTEXITCODE`n$(Get-Content $log -Raw)" }
    if ((Get-Content -LiteralPath $codexPolicy -Raw) -ne $codexPolicyBefore) {
        throw 'La ré-application de la politique globale déjà à jour a modifié le fichier.'
    }
    if ((Get-Content -LiteralPath $log -Raw -Encoding UTF8) -notmatch 'politique globale d.j. . jour') {
        throw 'Le rejeu idempotent ne rapporte pas explicitement "déjà à jour".'
    }

    # Manual edit inside the managed block is drift: detected, reported, never overwritten.
    (Get-Content -LiteralPath $codexPolicy -Raw).Replace('mcp-search-net', 'mcp-search-net (modifié à la main)') |
        Set-Content -LiteralPath $codexPolicy -Encoding UTF8 -NoNewline
    $codexPolicyDrifted = Get-Content -LiteralPath $codexPolicy -Raw
    & $ScriptUnderTest -Mode Apply -InstallRoot $InstallRoot -Clients 'codex' -LogPath $log
    if ($LASTEXITCODE -eq 0) { throw 'La dérive manuelle de la politique globale aurait dû faire échouer Apply.' }
    if ((Get-Content $log -Raw) -notmatch 'MCP_CONFIG_MANAGED_POLICY_DRIFT') {
        throw "La dérive manuelle n'a pas été rapportée avec le bon code : $(Get-Content $log -Raw)"
    }
    if ((Get-Content -LiteralPath $codexPolicy -Raw) -ne $codexPolicyDrifted) {
        throw 'La dérive manuelle de la politique globale a été écrasée au lieu d''être préservée.'
    }

    Write-Host 'WINDOWS_CLIENT_INTEGRATION_PREFLIGHT_PASS'
    # The drift sub-test above is an intentional native failure (exit 20) exercised on
    # purpose to prove drift detection works. Without resetting it here, $LASTEXITCODE would
    # still read 20 when this script returns, which would make any caller that checks
    # $LASTEXITCODE after `& test-client-integration-preflight.ps1` see a false failure.
    exit 0
}
finally {
    $env:LOCALAPPDATA = $OriginalLocal
    $env:APPDATA = $OriginalRoaming
    $env:USERPROFILE = $OriginalUser
    $env:PATH = $OriginalPath
    Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
}
