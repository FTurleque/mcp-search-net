[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$files = @(
    'scripts\certify-native-clients.ps1',
    'packaging\windows\configure-install.ps1'
)

foreach ($path in $files) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $path),
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    if (@($parseErrors).Count -gt 0) {
        $details = @($parseErrors | ForEach-Object {
            "line=$($_.Extent.StartLineNumber) col=$($_.Extent.StartColumnNumber) text=[$($_.Extent.Text)] message=$($_.Message)"
        }) -join '; '
        throw "PowerShell parse failed for ${path}: $details"
    }
}

# Copilot wiring remains supported for compatibility even though it is no longer
# part of the native certification scope.
$configure = Get-Content -LiteralPath 'packaging\windows\configure-install.ps1' -Raw
if ($configure -notmatch "'add-json', '--scope', 'user'") { throw 'Claude Code add-json user-scope wiring is missing.' }
if (-not $configure.Contains("'.copilot\mcp-config.json'")) { throw 'Copilot CLI compatibility config path is missing.' }
if ($configure -notmatch '\$CopilotCliEntry') { throw 'Copilot CLI compatibility JSON entry is missing.' }
if ($configure -match '\$copilotAddArgs') { throw 'Legacy Copilot CLI mcp add wiring must not return.' }
if ($configure -match '\$claudeAddArgs') { throw 'Legacy Claude Code mcp add wiring must not return.' }
if ($configure -notmatch "'mcp', 'get', 'mcp-search-net', '--json'") { throw 'Copilot CLI compatibility post-write verification is missing.' }
if ($configure -notmatch 'Test-NativeServerOutput') { throw 'Native server verification is missing.' }

if ($configure -notmatch 'function\s+New-ManagedClientEnv') { throw 'Managed client environment helper is missing.' }
foreach ($requiredPathVariable in @('MCP_SEARCH_HOME', 'MCP_CONFIG_PATH', 'MCP_CATALOG_PATH')) {
    if ($configure -notmatch [regex]::Escape($requiredPathVariable)) {
        throw "Managed client path variable is missing: $requiredPathVariable"
    }
}
if ($configure -notmatch '\$managedEnv\s*=\s*New-ManagedClientEnv\b') {
    throw 'Shared managed client environment initialization is missing.'
}

# The managed environment is intentionally materialized once and reused by the
# client payloads. Count both the shared uses and the direct example use so this
# contract follows the semantic wiring instead of requiring duplicated calls.
$managedEnvDirectUses = [regex]::Matches($configure, 'env\s*=\s*\(New-ManagedClientEnv\)').Count
$managedEnvSharedUses = [regex]::Matches($configure, 'env\s*=\s*\$managedEnv\b').Count
$managedEnvUses = $managedEnvDirectUses + $managedEnvSharedUses

if ($managedEnvDirectUses -lt 1) {
    throw "Expected at least one direct confined stdio env use, got $managedEnvDirectUses."
}
if ($managedEnvSharedUses -lt 4) {
    throw "Expected at least four shared confined stdio env uses for supported integrations, got $managedEnvSharedUses."
}
if ($managedEnvUses -lt 5) {
    throw "Expected at least five confined stdio env uses for supported integrations, got $managedEnvUses."
}

if ($configure -match '\$listed\s+-and\s+\$alreadyManaged') {
    throw 'Managed CLI entries must be rewritten, not accepted only because mcp get succeeds.'
}

if ($configure -notmatch 'function\s+New-CodexMcpBlock') {
    throw 'Codex MCP block builder is missing.'
}
$codexConfinementPatterns = @(
    '\$homeLine\s*=\s*''MCP_SEARCH_HOME\s*=',
    '\$configLine\s*=\s*''MCP_CONFIG_PATH\s*=',
    '\$catalogLine\s*=\s*''MCP_CATALOG_PATH\s*=',
    '\[mcp_servers\.mcp-search-net\.env\]',
    '\$homeLine,\s*\r?\n\s*\$configLine,\s*\r?\n\s*\$catalogLine,'
)
foreach ($pattern in $codexConfinementPatterns) {
    if ($configure -notmatch $pattern) {
        throw "Codex config/catalog path confinement is missing for pattern: $pattern"
    }
}

Write-Host "NATIVE_CLIENT_CERTIFICATION_PARSE_VALID files=$($files.Count) confinedEnvUses=$managedEnvUses directUses=$managedEnvDirectUses sharedUses=$managedEnvSharedUses"
