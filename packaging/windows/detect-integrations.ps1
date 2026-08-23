[CmdletBinding()]
param(
    [ValidateSet('Detect', 'Apply')] [string] $Mode = 'Detect',
    [string] $Out = '',
    [string] $InstallRoot = '',
    [string] $Clients = '',
    [string] $LogPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = [Environment]::GetEnvironmentVariable('MCP_SEARCH_HOME', 'User')
}
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\mcp-search-net'
}
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)

$ServerName = 'mcp-search-net'
$BinLauncher = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$ConfigPath = Join-Path $InstallRoot 'config\application.yml'
$CatalogPath = Join-Path $InstallRoot 'data\catalog.db'
$IntegrationsFile = Join-Path $InstallRoot 'mcp-client-integrations.json'
$BackupRoot = Join-Path $InstallRoot '.config-backups'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$MoveFileReplaceExisting = 0x1
$MoveFileWriteThrough = 0x8

if (-not ([System.Management.Automation.PSTypeName]'McpSearchNet.PreflightFileOps').Type) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace McpSearchNet {
    public static class PreflightFileOps {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool MoveFileEx(string existingFileName, string newFileName, uint flags);
    }
}
'@
}

function Write-Result([string] $Message) {
    Write-Host $Message
    if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
        $dir = Split-Path $LogPath -Parent
        if ($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        [System.IO.File]::AppendAllText($LogPath, $Message + [Environment]::NewLine, $Utf8NoBom)
    }
}

function Write-AtomicText([string] $Path, [string] $Content) {
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $leaf = Split-Path $Path -Leaf
    $tmp = Join-Path $dir ('.' + $leaf + '.tmp-' + $PID + '-' + [guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllText($tmp, $Content, $Utf8NoBom)
        $flags = $MoveFileWriteThrough
        if (Test-Path -LiteralPath $Path -PathType Leaf) { $flags = $flags -bor $MoveFileReplaceExisting }
        if (-not [McpSearchNet.PreflightFileOps]::MoveFileEx($tmp, $Path, [uint32]$flags)) {
            $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw (New-Object System.ComponentModel.Win32Exception($code, "Publication atomique impossible vers '$Path'"))
        }
    }
    finally {
        if (Test-Path -LiteralPath $tmp -PathType Leaf) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
    }
}

function Backup-ClientConfig([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $stamp = [datetime]::UtcNow.ToString('yyyyMMddHHmmssfff')
    $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
    Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupRoot "$stamp-$suffix-$(Split-Path $Path -Leaf)") -Force
}

function Get-BytesSha256([byte[]] $Bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-ObjectFingerprint([object] $Value) {
    return Get-BytesSha256 ($Utf8NoBom.GetBytes(($Value | ConvertTo-Json -Depth 10 -Compress)))
}

function Read-JsonState([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [PSCustomObject]@{ Exists = $false; Valid = $true; Data = [PSCustomObject]@{}; Error = '' }
    }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { throw 'fichier vide' }
        return [PSCustomObject]@{ Exists = $true; Valid = $true; Data = ($raw | ConvertFrom-Json); Error = '' }
    }
    catch {
        return [PSCustomObject]@{ Exists = $true; Valid = $false; Data = $null; Error = $_.Exception.Message }
    }
}

function Write-JsonData([string] $Path, [object] $Data) {
    Write-AtomicText $Path (($Data | ConvertTo-Json -Depth 10).TrimEnd() + "`r`n")
}

function Get-PropertyExists([object] $Object, [string] $Name) {
    if ($null -eq $Object) { return $false }
    return $null -ne ($Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1)
}

function Test-PropertySet([object] $Object, [string[]] $Expected) {
    if ($null -eq $Object) { return $false }
    $actual = @($Object.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    return ($actual.Count -eq $wanted.Count) -and (($actual -join "`n") -ceq ($wanted -join "`n"))
}

function Test-PathEqual([string] $Left, [string] $Right) {
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    try {
        $a = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
        $b = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
        return $a.Equals($b, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $Left.Equals($Right, [System.StringComparison]::OrdinalIgnoreCase) }
}

function Test-ArgsExact([object] $Value) {
    $argsValue = @($Value)
    return $argsValue.Count -eq 4 -and
        [string]$argsValue[0] -ceq '/d' -and
        [string]$argsValue[1] -ceq '/s' -and
        [string]$argsValue[2] -ceq '/c' -and
        (Test-PathEqual ([string]$argsValue[3]) $BinLauncher)
}

function Test-EnvExact([object] $Value) {
    if (-not (Test-PropertySet $Value @('MCP_SEARCH_HOME', 'MCP_CONFIG_PATH', 'MCP_CATALOG_PATH'))) { return $false }
    return (Test-PathEqual ([string]$Value.MCP_SEARCH_HOME) $InstallRoot) -and
        (Test-PathEqual ([string]$Value.MCP_CONFIG_PATH) $ConfigPath) -and
        (Test-PathEqual ([string]$Value.MCP_CATALOG_PATH) $CatalogPath)
}

function Test-JsonEntryExact([object] $Entry, [string] $Kind) {
    if ($null -eq $Entry) { return $false }
    switch ($Kind) {
        'JetBrains' {
            if (-not (Test-PropertySet $Entry @('type', 'command', 'args', 'env')) -or [string]$Entry.type -cne 'stdio') { return $false }
        }
        'ClaudeDesktop' {
            if (-not (Test-PropertySet $Entry @('command', 'args', 'env'))) { return $false }
        }
        'ClaudeCode' {
            if (-not (Test-PropertySet $Entry @('type', 'command', 'args', 'env')) -or [string]$Entry.type -cne 'stdio') { return $false }
        }
        'CopilotCli' {
            if (-not (Test-PropertySet $Entry @('type', 'command', 'args', 'env', 'tools')) -or [string]$Entry.type -cne 'stdio') { return $false }
            $tools = @($Entry.tools)
            if ($tools.Count -ne 1 -or [string]$tools[0] -cne '*') { return $false }
        }
        default { return $false }
    }
    if (-not ([string]$Entry.command).Equals('cmd.exe', [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    return (Test-ArgsExact $Entry.args) -and (Test-EnvExact $Entry.env)
}

function New-ExpectedEntry([string] $Kind) {
    $envValue = [PSCustomObject][ordered]@{
        MCP_SEARCH_HOME = $InstallRoot
        MCP_CONFIG_PATH = $ConfigPath
        MCP_CATALOG_PATH = $CatalogPath
    }
    switch ($Kind) {
        'JetBrains' { return [PSCustomObject][ordered]@{ type = 'stdio'; command = 'cmd.exe'; args = @('/d', '/s', '/c', $BinLauncher); env = $envValue } }
        'ClaudeDesktop' { return [PSCustomObject][ordered]@{ command = 'cmd.exe'; args = @('/d', '/s', '/c', $BinLauncher); env = $envValue } }
        'ClaudeCode' { return [PSCustomObject][ordered]@{ type = 'stdio'; command = 'cmd.exe'; args = @('/d', '/s', '/c', $BinLauncher); env = $envValue } }
        'CopilotCli' { return [PSCustomObject][ordered]@{ type = 'stdio'; command = 'cmd.exe'; args = @('/d', '/s', '/c', $BinLauncher); env = $envValue; tools = @('*') } }
        default { throw "Type d'intégration inconnu : $Kind" }
    }
}

function Resolve-RealCommand([string] $Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.CommandType -in @('Application', 'ExternalScript')) { return $command.Source }
    return $null
}

function Test-VsCodeShim([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $lower = $Path.ToLowerInvariant()
    return ($lower -like '*microsoft vs code*') -or ($lower -like '*code\bin*') -or ($lower -like '*vscode*\bin*')
}

function Test-CommandCapability([string] $Path, [string[]] $Arguments) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    try { & $Path @Arguments 2>&1 | Out-Null; return $LASTEXITCODE -eq 0 }
    catch { return $false }
}

function Resolve-ClaudeDesktopConfig {
    $packagesDir = Join-Path $env:LOCALAPPDATA 'Packages'
    if (Test-Path -LiteralPath $packagesDir -PathType Container) {
        foreach ($pkg in @(Get-ChildItem -LiteralPath $packagesDir -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue)) {
            $candidate = Join-Path $pkg.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'
            if (Test-Path -LiteralPath (Split-Path $candidate -Parent) -PathType Container) { return $candidate }
        }
    }
    $appDataClaude = Join-Path $env:APPDATA 'Claude'
    $config = Join-Path $appDataClaude 'claude_desktop_config.json'
    $logs = Join-Path $appDataClaude 'logs'
    if ((Test-Path -LiteralPath $config -PathType Leaf) -or (Test-Path -LiteralPath $logs -PathType Container)) { return $config }
    return $null
}

function Resolve-ClaudeExe {
    $command = Resolve-RealCommand 'claude'
    if ($command) { return $command }
    $native = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    if (Test-Path -LiteralPath $native -PathType Leaf) { return $native }
    $embeddedRoot = Join-Path $env:APPDATA 'Claude\claude-code'
    if (Test-Path -LiteralPath $embeddedRoot -PathType Container) {
        $embedded = Get-ChildItem -LiteralPath $embeddedRoot -Recurse -Filter 'claude.exe' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($embedded) { return $embedded.FullName }
    }
    return $null
}

function New-Probe([bool] $Installed, [string] $State, [string] $Reason, [string] $ClientKey, [string] $ConfigFile, [string] $Kind, [string] $RootKey, [string[]] $LegacyRootKeys = @()) {
    return [PSCustomObject]@{
        Installed = $Installed; State = $State; Reason = $Reason; ClientKey = $ClientKey;
        ConfigPath = $ConfigFile; Kind = $Kind; RootKey = $RootKey; LegacyRootKeys = $LegacyRootKeys
    }
}

function Get-JsonProbe([bool] $Installed, [string] $Label, [string] $ClientKey, [string] $ConfigFile, [string] $RootKey, [string] $Kind, [string[]] $LegacyRootKeys = @()) {
    if (-not $Installed) { return New-Probe $false 'Absent' "$Label non installé" $ClientKey $ConfigFile $Kind $RootKey $LegacyRootKeys }
    $snapshot = Read-JsonState $ConfigFile
    if (-not $snapshot.Valid) { return New-Probe $true 'Invalid' "$Label : configuration JSON invalide — correction automatique désactivée" $ClientKey $ConfigFile $Kind $RootKey $LegacyRootKeys }
    $data = $snapshot.Data
    if ((Get-PropertyExists $data $RootKey) -and (Get-PropertyExists $data.$RootKey $ServerName)) {
        $entry = $data.$RootKey.$ServerName
        if (Test-JsonEntryExact $entry $Kind) { return New-Probe $true 'Integrated' "$Label : mcp-search-net déjà intégré et conforme à cette version" $ClientKey $ConfigFile $Kind $RootKey $LegacyRootKeys }
        return New-Probe $true 'Drift' "$Label : mcp-search-net présent mais configuration différente — mise à jour proposée" $ClientKey $ConfigFile $Kind $RootKey $LegacyRootKeys
    }
    foreach ($legacy in $LegacyRootKeys) {
        if ((Get-PropertyExists $data $legacy) -and (Get-PropertyExists $data.$legacy $ServerName)) {
            return New-Probe $true 'Drift' "$Label : mcp-search-net présent dans un emplacement obsolète — mise à jour proposée" $ClientKey $ConfigFile $Kind $RootKey $LegacyRootKeys
        }
    }
    return New-Probe $true 'Missing' "$Label détecté — mcp-search-net non intégré" $ClientKey $ConfigFile $Kind $RootKey $LegacyRootKeys
}

function Get-TomlSectionMap([string] $Text, [string] $Header) {
    $pattern = '(?ms)^\s*\[' + [regex]::Escape($Header) + '\]\s*(?:\r?\n|$)(.*?)(?=^\s*\[|\z)'
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) { return $null }
    $map = @{}
    foreach ($line in @($match.Groups[1].Value -split '\r?\n')) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $separator = $trimmed.IndexOf('=')
        if ($separator -le 0) { return $null }
        $map[$trimmed.Substring(0, $separator).Trim()] = $trimmed.Substring($separator + 1).Trim()
    }
    return $map
}

function ConvertFrom-TomlQuoted([string] $Value) {
    $trimmed = $Value.Trim()
    if ($trimmed.Length -lt 2 -or $trimmed[0] -ne '"' -or $trimmed[$trimmed.Length - 1] -ne '"') { return $null }
    return $trimmed.Substring(1, $trimmed.Length - 2).Replace('\\', '\')
}

function Test-CodexExact([string] $Text) {
    $main = Get-TomlSectionMap $Text 'mcp_servers.mcp-search-net'
    $envMap = Get-TomlSectionMap $Text 'mcp_servers.mcp-search-net.env'
    if ($null -eq $main -or $null -eq $envMap -or $main.Count -ne 3 -or $envMap.Count -ne 3) { return $false }
    if (-not $main.ContainsKey('command') -or (ConvertFrom-TomlQuoted $main['command']) -cne 'cmd.exe') { return $false }
    if (-not $main.ContainsKey('enabled') -or $main['enabled'].ToLowerInvariant() -ne 'true') { return $false }
    if (-not $main.ContainsKey('args')) { return $false }
    $expectedArgs = ('["/d","/s","/c","' + $BinLauncher.Replace('\', '\\') + '"]').Replace(' ', '')
    if ($main['args'].Replace(' ', '') -cne $expectedArgs) { return $false }
    foreach ($item in @(
        @{ Key = 'MCP_SEARCH_HOME'; Value = $InstallRoot },
        @{ Key = 'MCP_CONFIG_PATH'; Value = $ConfigPath },
        @{ Key = 'MCP_CATALOG_PATH'; Value = $CatalogPath }
    )) {
        if (-not $envMap.ContainsKey($item.Key) -or -not (Test-PathEqual (ConvertFrom-TomlQuoted $envMap[$item.Key]) $item.Value)) { return $false }
    }
    return $true
}

function Get-CodexProbe {
    $configFile = Join-Path $env:USERPROFILE '.codex\config.toml'
    $installed = Test-Path -LiteralPath $configFile -PathType Leaf
    if (-not $installed) { $installed = $null -ne (Resolve-RealCommand 'codex') }
    if (-not $installed) {
        foreach ($candidate in @((Join-Path $env:LOCALAPPDATA 'Programs\Codex\Codex.exe'), (Join-Path $env:LOCALAPPDATA 'Codex\Codex.exe'))) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $installed = $true; break }
        }
    }
    if (-not $installed) { return New-Probe $false 'Absent' 'Codex Desktop non installé' 'codex' $configFile 'Codex' '' }
    if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { return New-Probe $true 'Missing' 'Codex Desktop détecté — mcp-search-net non intégré' 'codex' $configFile 'Codex' '' }
    $text = [System.IO.File]::ReadAllText($configFile, [System.Text.Encoding]::UTF8)
    if ($text -notmatch '(?m)^\s*\[mcp_servers\.mcp-search-net\]\s*(?:#.*)?$') { return New-Probe $true 'Missing' 'Codex Desktop détecté — mcp-search-net non intégré' 'codex' $configFile 'Codex' '' }
    if (Test-CodexExact $text) { return New-Probe $true 'Integrated' 'Codex Desktop : mcp-search-net déjà intégré et conforme à cette version' 'codex' $configFile 'Codex' '' }
    return New-Probe $true 'Drift' 'Codex Desktop : mcp-search-net présent mais configuration différente — mise à jour proposée' 'codex' $configFile 'Codex' ''
}

function Get-Probes {
    $jbDir = Join-Path $env:LOCALAPPDATA 'github-copilot\intellij'
    $copilotPath = Resolve-RealCommand 'copilot'
    $copilotInstalled = $false
    if ($copilotPath -and -not (Test-VsCodeShim $copilotPath)) { $copilotInstalled = Test-CommandCapability $copilotPath @('mcp', '--help') }
    $desktopConfig = Resolve-ClaudeDesktopConfig
    $claudeExe = Resolve-ClaudeExe
    return [ordered]@{
        CopilotJetBrains = Get-JsonProbe (Test-Path -LiteralPath $jbDir -PathType Container) 'Copilot JetBrains' 'copilot-jetbrains' (Join-Path $jbDir 'mcp.json') 'servers' 'JetBrains' @('mcpServers')
        CopilotCli = Get-JsonProbe $copilotInstalled 'GitHub Copilot CLI' 'copilot-cli' (Join-Path $env:USERPROFILE '.copilot\mcp-config.json') 'mcpServers' 'CopilotCli'
        ClaudeDesktop = Get-JsonProbe ($null -ne $desktopConfig) 'Claude Desktop' 'claude-desktop' ([string]$desktopConfig) 'mcpServers' 'ClaudeDesktop'
        ClaudeCode = Get-JsonProbe ($null -ne $claudeExe) 'Claude Code CLI' 'claude-code' (Join-Path $env:USERPROFILE '.claude.json') 'mcpServers' 'ClaudeCode'
        CodexDesktop = Get-CodexProbe
    }
}

function Write-IniSection([System.Collections.Generic.List[string]] $Lines, [string] $Name, [object] $Probe) {
    $selectable = $Probe.State -in @('Missing', 'Drift')
    $Lines.Add("[$Name]")
    $Lines.Add('Installed=' + $(if ($Probe.Installed) { '1' } else { '0' }))
    $Lines.Add('Available=' + $(if ($selectable) { '1' } else { '0' }))
    $Lines.Add('AlreadyIntegrated=' + $(if ($Probe.State -eq 'Integrated') { '1' } else { '0' }))
    $Lines.Add('State=' + [string]$Probe.State)
    $Lines.Add('Reason=' + [string]$Probe.Reason)
}

function Save-ManagedRecord([string] $Key, [string] $ClientConfigPath, [string] $Fingerprint) {
    $snapshot = Read-JsonState $IntegrationsFile
    if (-not $snapshot.Valid) { throw "Métadonnées d'intégration JSON invalides : $($snapshot.Error)" }
    $record = [PSCustomObject][ordered]@{
        ownership = 'managed'; state = 'applied'; transactionId = [guid]::NewGuid().ToString('N');
        configPath = $ClientConfigPath; entryFingerprint = $Fingerprint; configuredAt = [datetime]::UtcNow.ToString('o')
    }
    $snapshot.Data | Add-Member -NotePropertyName $Key -NotePropertyValue $record -Force
    Write-JsonData $IntegrationsFile $snapshot.Data
}

function Set-JsonIntegration([object] $Probe) {
    if ($Probe.State -eq 'Integrated') { Write-Result "$($Probe.ClientKey) : déjà conforme, aucune modification."; return }
    if ($Probe.State -eq 'Invalid') { throw $Probe.Reason }
    if (-not $Probe.Installed) { throw $Probe.Reason }
    $snapshot = Read-JsonState $Probe.ConfigPath
    if (-not $snapshot.Valid) { throw "Configuration JSON invalide '$($Probe.ConfigPath)' : $($snapshot.Error)" }
    $data = $snapshot.Data
    if (-not (Get-PropertyExists $data $Probe.RootKey)) { $data | Add-Member -NotePropertyName $Probe.RootKey -NotePropertyValue ([PSCustomObject]@{}) -Force }
    foreach ($legacy in @($Probe.LegacyRootKeys)) {
        if ((Get-PropertyExists $data $legacy) -and (Get-PropertyExists $data.$legacy $ServerName)) { $data.$legacy.PSObject.Properties.Remove($ServerName) }
    }
    $expected = New-ExpectedEntry $Probe.Kind
    $data.$($Probe.RootKey) | Add-Member -NotePropertyName $ServerName -NotePropertyValue $expected -Force
    Backup-ClientConfig $Probe.ConfigPath
    Write-JsonData $Probe.ConfigPath $data
    $verify = Read-JsonState $Probe.ConfigPath
    if (-not $verify.Valid -or -not (Get-PropertyExists $verify.Data $Probe.RootKey) -or -not (Get-PropertyExists $verify.Data.$($Probe.RootKey) $ServerName) -or -not (Test-JsonEntryExact $verify.Data.$($Probe.RootKey).$ServerName $Probe.Kind)) {
        throw "La vérification post-écriture a échoué : $($Probe.ConfigPath)"
    }
    Save-ManagedRecord "$($Probe.ClientKey):$ServerName" $Probe.ConfigPath (Get-ObjectFingerprint $expected)
    Write-Result "$($Probe.ClientKey) : mcp-search-net configuré et vérifié -> $($Probe.ConfigPath)"
}

function Remove-TomlSection([string] $Text, [string] $Header) {
    return [regex]::Replace($Text, '(?ms)^\s*\[' + [regex]::Escape($Header) + '\]\s*(?:\r?\n|$).*?(?=^\s*\[|\z)', '')
}

function New-CodexBlock {
    $argsLine = 'args = ["/d", "/s", "/c", "' + $BinLauncher.Replace('\', '\\') + '"]'
    $homeLine = 'MCP_SEARCH_HOME = "' + $InstallRoot.Replace('\', '\\') + '"'
    $configLine = 'MCP_CONFIG_PATH = "' + $ConfigPath.Replace('\', '\\') + '"'
    $catalogLine = 'MCP_CATALOG_PATH = "' + $CatalogPath.Replace('\', '\\') + '"'
    return ('# BEGIN MCP-SEARCH-NET', '[mcp_servers.mcp-search-net]', 'command = "cmd.exe"', $argsLine, 'enabled = true', '', '[mcp_servers.mcp-search-net.env]', $homeLine, $configLine, $catalogLine, '# END MCP-SEARCH-NET') -join [Environment]::NewLine
}

function Set-CodexIntegration([object] $Probe) {
    if ($Probe.State -eq 'Integrated') { Write-Result 'codex : déjà conforme, aucune modification.'; return }
    if (-not $Probe.Installed) { throw $Probe.Reason }
    $text = if (Test-Path -LiteralPath $Probe.ConfigPath -PathType Leaf) { [System.IO.File]::ReadAllText($Probe.ConfigPath, [System.Text.Encoding]::UTF8) } else { '' }
    Backup-ClientConfig $Probe.ConfigPath
    $cleaned = Remove-TomlSection $text 'mcp_servers.mcp-search-net.env'
    $cleaned = Remove-TomlSection $cleaned 'mcp_servers.mcp-search-net'
    $cleaned = [regex]::Replace($cleaned, '(?m)^\s*# (?:BEGIN|END) MCP-SEARCH-NET\s*\r?\n?', '')
    $block = New-CodexBlock
    $prefix = $cleaned.TrimEnd()
    $newText = if ($prefix) { $prefix + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine } else { $block + [Environment]::NewLine }
    Write-AtomicText $Probe.ConfigPath $newText
    if (-not (Test-CodexExact ([System.IO.File]::ReadAllText($Probe.ConfigPath, [System.Text.Encoding]::UTF8))) { throw "La vérification post-écriture Codex a échoué : $($Probe.ConfigPath)" }
    Save-ManagedRecord "codex:$ServerName" $Probe.ConfigPath (Get-BytesSha256 ($Utf8NoBom.GetBytes($block)))
    Write-Result "codex : mcp-search-net configuré et vérifié -> $($Probe.ConfigPath)"
}

$probes = Get-Probes

if ($Mode -eq 'Detect') {
    if ([string]::IsNullOrWhiteSpace($Out)) { throw '-Out est requis en mode Detect.' }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($section in @('CopilotJetBrains', 'CopilotCli', 'ClaudeDesktop', 'ClaudeCode', 'CodexDesktop')) { Write-IniSection $lines $section $probes[$section] }
    [System.IO.File]::WriteAllLines($Out, [string[]]$lines.ToArray(), [System.Text.Encoding]::Unicode)
    exit 0
}

if (-not [string]::IsNullOrWhiteSpace($LogPath)) { Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue }
$clientMap = @{
    'copilot-jetbrains' = 'CopilotJetBrains'; 'copilot-cli' = 'CopilotCli'; 'claude-desktop' = 'ClaudeDesktop';
    'claude-code' = 'ClaudeCode'; 'codex' = 'CodexDesktop'
}
$selected = @($Clients -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
$failures = New-Object System.Collections.Generic.List[string]
foreach ($client in $selected) {
    try {
        if (-not $clientMap.ContainsKey($client)) { throw "Client inconnu : $client" }
        $probe = $probes[$clientMap[$client]]
        if ($probe.Kind -eq 'Codex') { Set-CodexIntegration $probe } else { Set-JsonIntegration $probe }
    }
    catch {
        $failure = "$client : $($_.Exception.Message)"
        $failures.Add($failure)
        Write-Result "ECHEC $failure"
    }
}
if ($failures.Count -gt 0) { Write-Result "MCP_CLIENT_INTEGRATION_FAILURE count=$($failures.Count)"; exit 20 }
Write-Result "MCP_CLIENT_INTEGRATION_SUCCESS count=$($selected.Count)"
exit 0
