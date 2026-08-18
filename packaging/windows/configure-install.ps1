[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallRoot,
    [switch] $SmokeMode,
    [switch] $Uninstall,
    [switch] $FromInstaller,
    [string] $Clients = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$IntegrationsFile = Join-Path $InstallRoot 'mcp-client-integrations.json'
$BackupRoot = Join-Path $InstallRoot '.config-backups'
$EnvFile = Join-Path $InstallRoot '.env'
$MoveFileReplaceExisting = 0x1
$MoveFileWriteThrough = 0x8
$MaterialFailures = New-Object System.Collections.Generic.List[string]

if (-not ([System.Management.Automation.PSTypeName]'McpSearchNet.ConfigFileOps').Type) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace McpSearchNet {
    public static class ConfigFileOps {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool MoveFileEx(string existingFileName, string newFileName, uint flags);
    }
}
'@
}

function Record-MaterialFailure {
    param(
        [Parameter(Mandatory)] [string] $Scope,
        [Parameter(Mandatory)] [string] $Message
    )
    $entry = "$Scope : $Message"
    $script:MaterialFailures.Add($entry)
    Write-Host "  $entry" -ForegroundColor Red
}

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Test-ProcessAlive {
    param([Parameter(Mandatory)] [int] $ProcessId)
    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Remove-AbandonedPublicationTemps {
    param(
        [Parameter(Mandatory)] [string] $Directory,
        [Parameter(Mandatory)] [string] $Leaf
    )

    $prefix = ".$Leaf.tmp-"
    foreach ($candidate in @(Get-ChildItem -LiteralPath $Directory -Force -File -ErrorAction SilentlyContinue)) {
        if (-not $candidate.Name.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        $suffix = $candidate.Name.Substring($prefix.Length)
        $separator = $suffix.IndexOf('-')
        if ($separator -le 0) { continue }
        $pidText = $suffix.Substring(0, $separator)
        $nonce = $suffix.Substring($separator + 1)
        $ownerPid = 0
        if (-not [int]::TryParse($pidText, [ref]$ownerPid)) { continue }
        if ($ownerPid -le 0 -or $nonce -notmatch '^[0-9a-fA-F]{32}$') { continue }
        if (Test-ProcessAlive -ProcessId $ownerPid) { continue }
        try {
            Remove-Item -LiteralPath $candidate.FullName -Force -ErrorAction Stop
        }
        catch {
            throw "MCP_CONFIG_STALE_TEMP_CLEANUP_FAILED: impossible de supprimer '$($candidate.FullName)' : $($_.Exception.Message)"
        }
    }
}

function Write-DurableUtf8File {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Content
    )

    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    $leaf = [System.IO.Path]::GetFileName($Path)
    Remove-AbandonedPublicationTemps -Directory $dir -Leaf $leaf
    $tmp = Join-Path $dir ('.' + $leaf + '.tmp-' + $PID + '-' + [guid]::NewGuid().ToString('N'))
    $stream = $null
    try {
        $bytes = $Utf8NoBom.GetBytes($Content)
        $stream = [System.IO.FileStream]::new(
            $tmp,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None,
            4096,
            [System.IO.FileOptions]::WriteThrough
        )
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null

        $crashTarget = [string]$env:MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH
        if ($crashTarget -and (
            $crashTarget -eq '*' -or
            $crashTarget.Equals($leaf, [System.StringComparison]::OrdinalIgnoreCase)
        )) {
            [System.Environment]::FailFast("MCP_CONFIG_TEST_CRASH_BEFORE_PUBLISH:$leaf")
        }

        $flags = $MoveFileWriteThrough
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $flags = $flags -bor $MoveFileReplaceExisting
        }
        if (-not [McpSearchNet.ConfigFileOps]::MoveFileEx($tmp, $Path, [uint32]$flags)) {
            $errorCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw (New-Object System.ComponentModel.Win32Exception($errorCode, "Publication atomique durable impossible vers '$Path'"))
        }
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $tmp -PathType Leaf) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
    }
}

function Read-JsonFile([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [PSCustomObject]@{} }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        if (-not $raw.Trim()) { throw 'le fichier est vide' }
        return ($raw | ConvertFrom-Json)
    }
    catch {
        throw "Configuration JSON invalide '$Path' : $($_.Exception.Message)"
    }
}

function ConvertTo-StableJson {
    param([Parameter(Mandatory)] [object] $Data)

    $node = Join-Path $InstallRoot 'runtime\node-v24.18.0-win-x64\node.exe'
    if (Test-Path -LiteralPath $node -PathType Leaf) {
        $tmp = $null
        try {
            $tmp = [System.IO.Path]::GetTempFileName()
            $compressed = $Data | ConvertTo-Json -Depth 10 -Compress
            [System.IO.File]::WriteAllText($tmp, $compressed, $Utf8NoBom)
            $jsCode = "const fs=require('fs');const d=fs.readFileSync(process.argv[1],'utf8');process.stdout.write(JSON.stringify(JSON.parse(d),null,2))"
            $r = Invoke-ExternalProcess $node @('-e', $jsCode, $tmp) 10
            if ($r.Done -and $r.ExitCode -eq 0 -and $r.Stdout) {
                return ($r.Stdout.TrimEnd() + "`r`n")
            }
        }
        finally {
            if ($tmp -and (Test-Path -LiteralPath $tmp -PathType Leaf)) {
                Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $raw = $Data | ConvertTo-Json -Depth 10
    $json = [regex]::Replace($raw, '":\s{2,}', '": ')
    return ($json.TrimEnd() + "`r`n")
}

function Write-JsonFile([string] $Path, [object] $Data) {
    Write-DurableUtf8File -Path $Path -Content (ConvertTo-StableJson -Data $Data)
}

function Backup-ConfigFile([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $stamp = [datetime]::UtcNow.ToString('yyyyMMddHHmmssfff')
    $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $backup = Join-Path $BackupRoot "$stamp-$suffix-$(Split-Path $Path -Leaf)"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    return $backup
}

function Get-PropertyExists([pscustomobject] $Obj, [string] $Name) {
    return ($null -ne ($Obj.PSObject.Properties | Where-Object { $_.Name -eq $Name }))
}

function Load-Integrations {
    $data = Read-JsonFile $IntegrationsFile
    $ht = @{}
    foreach ($p in $data.PSObject.Properties) { $ht[$p.Name] = $p.Value }
    return $ht
}

function Save-Integrations([hashtable] $Table) {
    $obj = [PSCustomObject]@{}
    foreach ($key in ($Table.Keys | Sort-Object)) {
        $obj | Add-Member -NotePropertyName $key -NotePropertyValue $Table[$key] -Force
    }
    Write-JsonFile $IntegrationsFile $obj
}

function Invoke-ExternalProcess {
    param(
        [string] $Exe,
        [string[]] $ExeArgs = @(),
        [int] $Sec = 15,
        [switch] $ViaPs5
    )

    $ps5 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $realExe = if ($ViaPs5) { $ps5 } else { $Exe }
    $realArgs = if ($ViaPs5) {
        @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Exe) + $ExeArgs
    }
    else { $ExeArgs }

    $argStr = ($realArgs | ForEach-Object {
        if ($_ -match '[ "]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    }) -join ' '

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $realExe
    $psi.Arguments = $argStr
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()
        $finished = $proc.WaitForExit($Sec * 1000)
        if (-not $finished) {
            try { $proc.Kill() } catch { Write-Verbose "Impossible d'arrêter '$Exe' : $($_.Exception.Message)" }
        }
        [System.Threading.Tasks.Task]::WhenAll($outTask, $errTask).Wait(3000) | Out-Null
        $stdout = if ($outTask.IsCompleted) { $outTask.Result } else { '' }
        $stderr = if ($errTask.IsCompleted) { $errTask.Result } else { '' }
        $exitCode = if ($finished) { try { $proc.ExitCode } catch { -1 } } else { -1 }
        $proc.Dispose()
        return [PSCustomObject]@{
            Stdout = $stdout
            Stderr = $stderr
            Out = ($stdout + $stderr)
            Done = $finished
            ExitCode = $exitCode
        }
    }
    catch {
        return [PSCustomObject]@{
            Stdout = ''
            Stderr = $_.Exception.Message
            Out = $_.Exception.Message
            Done = $false
            ExitCode = -1
        }
    }
}

function Test-NativeServerOutput([object] $Result, [string] $ServerKey = 'mcp-search-net') {
    if ($null -eq $Result -or -not $Result.Done -or $Result.ExitCode -ne 0) { return $false }
    $text = [string]$Result.Out
    if ([string]::IsNullOrWhiteSpace($text)) { return $false }
    if ($text -match '(?i)not\s+found|no\s+MCP\s+server\s+named') { return $false }
    return $text -match [regex]::Escape($ServerKey)
}

function Get-SafeProcessSummary([object] $Result) {
    if ($null -eq $Result) { return '' }
    $text = ([string]$Result.Out).Trim()
    if ($text.Length -gt 500) { $text = $text.Substring(0, 500) + '...' }
    return ($text -replace '[\r\n]+', ' ')
}

function New-ManagedClientEnv {
    return [ordered]@{
        MCP_SEARCH_HOME = $InstallRoot
        MCP_CONFIG_PATH = (Join-Path $InstallRoot 'config\application.yml')
        MCP_CATALOG_PATH = (Join-Path $InstallRoot 'data\catalog.db')
    }
}

function Resolve-ClaudeDesktopConfig {
    try {
        $packagesDir = Join-Path $env:LOCALAPPDATA 'Packages'
        if (Test-Path -LiteralPath $packagesDir -PathType Container) {
            foreach ($pkg in (Get-ChildItem -LiteralPath $packagesDir -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue)) {
                $candidate = Join-Path $pkg.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'
                if (Test-Path -LiteralPath (Split-Path $candidate -Parent) -PathType Container) { return $candidate }
            }
        }
        $appDataClaude = Join-Path $env:APPDATA 'Claude'
        $configFile = Join-Path $appDataClaude 'claude_desktop_config.json'
        $logsDir = Join-Path $appDataClaude 'logs'
        if ((Test-Path -LiteralPath $configFile -PathType Leaf) -or (Test-Path -LiteralPath $logsDir -PathType Container)) {
            return $configFile
        }
    }
    catch {
        throw "Détection Claude Desktop impossible : $($_.Exception.Message)"
    }
    return $null
}

function Resolve-ClaudeExe {
    $cmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
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

function Resolve-CopilotExe {
    $cmd = Get-Command copilot -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.CommandType -in @('Application', 'ExternalScript')) { return $cmd.Source }
    return $null
}

function Install-JsonMcpClient {
    param(
        [Parameter(Mandatory)] [hashtable] $IntegrationTable,
        [Parameter(Mandatory)] [string] $ClientKey,
        [Parameter(Mandatory)] [string] $ConfigPath,
        [Parameter(Mandatory)] [pscustomobject] $Entry,
        [string] $RootKey = 'mcpServers',
        [string] $ServerKey = 'mcp-search-net'
    )

    $integKey = "${ClientKey}:${ServerKey}"
    $alreadyManaged = $IntegrationTable.ContainsKey($integKey) -and $IntegrationTable[$integKey].ownership -eq 'managed'
    $data = Read-JsonFile $ConfigPath
    if (-not (Get-PropertyExists $data $RootKey)) {
        $data | Add-Member -NotePropertyName $RootKey -NotePropertyValue ([PSCustomObject]@{}) -Force
    }
    $root = $data.$RootKey

    if ((Get-PropertyExists $root $ServerKey) -and -not $alreadyManaged) {
        Write-Host "  $ClientKey : entrée '$ServerKey' existante non gérée — préservée." -ForegroundColor Cyan
        $IntegrationTable[$integKey] = [PSCustomObject]@{
            ownership = 'preexisting'
            configPath = $ConfigPath
            configuredAt = [datetime]::UtcNow.ToString('o')
        }
        return
    }

    Backup-ConfigFile $ConfigPath | Out-Null
    $root | Add-Member -NotePropertyName $ServerKey -NotePropertyValue $Entry -Force
    Write-JsonFile $ConfigPath $data
    $IntegrationTable[$integKey] = [PSCustomObject]@{
        ownership = 'managed'
        configPath = $ConfigPath
        configuredAt = [datetime]::UtcNow.ToString('o')
    }
    Write-Host "  $ClientKey : '$ServerKey' configuré -> $ConfigPath" -ForegroundColor Green
}

function Remove-JsonMcpClient {
    param(
        [Parameter(Mandatory)] [hashtable] $IntegrationTable,
        [Parameter(Mandatory)] [string] $ClientKey,
        [string] $ConfigPath = '',
        [string] $ServerKey = 'mcp-search-net'
    )

    $integKey = "${ClientKey}:${ServerKey}"
    if (-not $IntegrationTable.ContainsKey($integKey)) {
        Write-Host "  $ClientKey : entrée non suivie par cet installateur — préservée." -ForegroundColor Cyan
        return
    }

    $record = $IntegrationTable[$integKey]
    if ($record.ownership -ne 'managed') {
        Write-Host "  $ClientKey : entrée préexistante/non gérée — préservée." -ForegroundColor Cyan
        $IntegrationTable.Remove($integKey)
        return
    }

    $resolvedPath = $ConfigPath
    if (Get-PropertyExists $record 'configPath') { $resolvedPath = [string]$record.configPath }
    if ($resolvedPath -and (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        $data = Read-JsonFile $resolvedPath
        foreach ($rootKey in @('mcpServers', 'servers')) {
            if ((Get-PropertyExists $data $rootKey) -and (Get-PropertyExists $data.$rootKey $ServerKey)) {
                Backup-ConfigFile $resolvedPath | Out-Null
                $data.$rootKey.PSObject.Properties.Remove($ServerKey)
                Write-JsonFile $resolvedPath $data
                Write-Host "  $ClientKey : '$ServerKey' retiré de $resolvedPath" -ForegroundColor Green
                break
            }
        }
    }
    $IntegrationTable.Remove($integKey)
}

if (-not $Uninstall -and -not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    $crawl4aiToken = New-LocalSecret
    $searxngSecret = New-LocalSecret
    $envContent = @(
        '# Secrets générés localement par l''installateur. Ne pas commiter ce fichier.'
        "CRAWL4AI_API_TOKEN=$crawl4aiToken"
        "MCP_CRAWL4AI_TOKEN=$crawl4aiToken"
        "SEARXNG_SECRET=$searxngSecret"
    ) -join "`r`n"
    Write-DurableUtf8File -Path $EnvFile -Content ($envContent + "`r`n")
    Write-Host "Secrets fournisseurs locaux générés : $EnvFile"
}

if ($SmokeMode) { exit 0 }

$AllClients = @('docker', 'copilot-jetbrains', 'copilot-cli', 'claude-desktop', 'claude-code', 'codex')
if ($FromInstaller) {
    $clientList = if ($Clients) { @($Clients -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } else { @() }
}
else { $clientList = $AllClients }

$DoDocker = -not $Uninstall -and ($clientList -contains 'docker')
$DoCopilotJB = $clientList -contains 'copilot-jetbrains'
$DoCopilotCli = $clientList -contains 'copilot-cli'
$DoClaudeDesktop = $clientList -contains 'claude-desktop'
$DoClaudeCode = $clientList -contains 'claude-code'
$DoCodex = $clientList -contains 'codex'

if (-not $Uninstall) {
    foreach ($file in @('compose.yaml', 'compose.hybrid.yaml')) {
        $source = Join-Path $InstallRoot "docker\$file"
        $destination = Join-Path $InstallRoot $file
        if ((Test-Path -LiteralPath $source -PathType Leaf) -and (-not (Test-Path -LiteralPath $destination -PathType Leaf))) {
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
    }
}

$BinLauncher = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$ContainerLauncher = Join-Path $InstallRoot 'bin\mcp-search-net-container.cmd'

if (-not $Uninstall) {
    $mcpExample = [ordered]@{
        mcpServers = [ordered]@{
            'mcp-search-net' = [ordered]@{
                type = 'local'
                command = 'cmd.exe'
                args = @('/d', '/s', '/c', $BinLauncher)
                env = (New-ManagedClientEnv)
                tools = @('*')
            }
        }
    }
    Write-JsonFile (Join-Path $InstallRoot 'mcp.json.example') $mcpExample

    $containerExample = [ordered]@{
        mcpServers = [ordered]@{
            'mcp-search-net-container' = [ordered]@{
                type = 'local'
                command = 'cmd.exe'
                args = @('/d', '/s', '/c', $ContainerLauncher)
                env = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
                tools = @('*')
            }
        }
    }
    Write-JsonFile (Join-Path $InstallRoot 'mcp.container.json.example') $containerExample
}

if ($DoDocker) {
    try {
        $composePath = @(
            (Join-Path $InstallRoot 'compose.yaml'),
            (Join-Path $InstallRoot 'docker\compose.yaml')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if ($docker -and $composePath) {
            $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $null = & $docker.Source info 2>&1
            $running = $LASTEXITCODE -eq 0
            $ErrorActionPreference = $previous
            if ($running) {
                $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                & $docker.Source compose --env-file $EnvFile -p mcp-search-net -f $composePath up -d searxng crawl4ai 2>&1 |
                    ForEach-Object { Write-Host "  $_" }
                $dockerExit = $LASTEXITCODE
                $ErrorActionPreference = $previous
                if ($dockerExit -ne 0) { Write-Host "Services Docker : démarrage incomplet (code $dockerExit)." -ForegroundColor Yellow }
                else { Write-Host 'Services Docker démarrés (SearXNG + Crawl4AI).' -ForegroundColor Green }
            }
            else { Write-Host 'Docker Desktop non démarré — services non lancés.' -ForegroundColor Yellow }
        }
        elseif (-not $docker) { Write-Host 'Docker absent du PATH — services non lancés.' -ForegroundColor Yellow }
    }
    catch { Write-Host "Docker : erreur lors du démarrage: $($_.Exception.Message)" -ForegroundColor Yellow }
}

if ($Uninstall) {
    try {
        $composePath = @(
            (Join-Path $InstallRoot 'compose.yaml'),
            (Join-Path $InstallRoot 'docker\compose.yaml')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if ($docker -and $composePath) {
            $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $null = & $docker.Source info 2>&1
            $running = $LASTEXITCODE -eq 0
            $ErrorActionPreference = $previous
            if ($running) {
                $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                & $docker.Source compose -p mcp-search-net -f $composePath down --remove-orphans 2>&1 |
                    ForEach-Object { Write-Host "  $_" }
                $dockerExit = $LASTEXITCODE
                $ErrorActionPreference = $previous
                if ($dockerExit -ne 0) { Write-Host "Docker down incomplet (code $dockerExit)." -ForegroundColor Yellow }
            }
        }
    }
    catch { Write-Host "Docker : erreur lors de l'arrêt: $($_.Exception.Message)" -ForegroundColor Yellow }
}

$integrations = Load-Integrations
$managedEnv = New-ManagedClientEnv
$JetBrainsEntry = [PSCustomObject]@{
    type = 'stdio'
    command = 'cmd.exe'
    args = @('/d', '/s', '/c', $BinLauncher)
    env = $managedEnv
}
$DesktopEntry = [PSCustomObject]@{
    command = 'cmd.exe'
    args = @('/d', '/s', '/c', $BinLauncher)
    env = $managedEnv
}

$CopilotJBDir = Join-Path $env:LOCALAPPDATA 'github-copilot\intellij'
$CopilotJBConfig = Join-Path $CopilotJBDir 'mcp.json'
if ($Uninstall) {
    try { Remove-JsonMcpClient -IntegrationTable $integrations -ClientKey 'copilot-jetbrains' -ConfigPath $CopilotJBConfig }
    catch { Record-MaterialFailure 'Copilot JetBrains uninstall' $_.Exception.Message }
}
elseif ($DoCopilotJB) {
    try {
        if (Test-Path -LiteralPath $CopilotJBDir -PathType Container) {
            Install-JsonMcpClient -IntegrationTable $integrations -ClientKey 'copilot-jetbrains' -ConfigPath $CopilotJBConfig -Entry $JetBrainsEntry -RootKey 'servers'
            $jbData = Read-JsonFile $CopilotJBConfig
            if ((Get-PropertyExists $jbData 'mcpServers') -and (Get-PropertyExists $jbData.mcpServers 'mcp-search-net')) {
                $legacyEntry = $jbData.mcpServers.'mcp-search-net'
                $legacyOwned = $false
                if ((Get-PropertyExists $legacyEntry 'env') -and
                    (Get-PropertyExists $legacyEntry.env 'MCP_SEARCH_HOME') -and
                    $legacyEntry.env.MCP_SEARCH_HOME -eq $InstallRoot) { $legacyOwned = $true }
                if ((Get-PropertyExists $legacyEntry 'args') -and (($legacyEntry.args -join ' ') -like "*$BinLauncher*")) { $legacyOwned = $true }
                if ($legacyOwned) {
                    Backup-ConfigFile $CopilotJBConfig | Out-Null
                    $jbData.mcpServers.PSObject.Properties.Remove('mcp-search-net')
                    if (-not [bool]($jbData.mcpServers.PSObject.Properties | Select-Object -First 1)) {
                        $jbData.PSObject.Properties.Remove('mcpServers')
                    }
                    Write-JsonFile $CopilotJBConfig $jbData
                }
            }
        }
        else { Write-Host 'Copilot JetBrains non détecté — configuration ignorée.' -ForegroundColor Yellow }
    }
    catch { Record-MaterialFailure 'Copilot JetBrains configuration' $_.Exception.Message }
}

$ClaudeDesktopConfig = $null
try { $ClaudeDesktopConfig = Resolve-ClaudeDesktopConfig }
catch { if ($DoClaudeDesktop -or $Uninstall) { Record-MaterialFailure 'Claude Desktop detection' $_.Exception.Message } }

if ($Uninstall) {
    try { Remove-JsonMcpClient -IntegrationTable $integrations -ClientKey 'claude-desktop' -ConfigPath ([string]$ClaudeDesktopConfig) }
    catch { Record-MaterialFailure 'Claude Desktop uninstall' $_.Exception.Message }
}
elseif ($DoClaudeDesktop) {
    try {
        if ($ClaudeDesktopConfig) {
            Install-JsonMcpClient -IntegrationTable $integrations -ClientKey 'claude-desktop' -ConfigPath $ClaudeDesktopConfig -Entry $DesktopEntry -RootKey 'mcpServers'
        }
        else { Write-Host 'Claude Desktop non détecté — configuration ignorée.' -ForegroundColor Yellow }
    }
    catch { Record-MaterialFailure 'Claude Desktop configuration' $_.Exception.Message }
}

$ClaudeExe = $null
try { $ClaudeExe = Resolve-ClaudeExe }
catch { if ($DoClaudeCode -or $Uninstall) { Record-MaterialFailure 'Claude Code detection' $_.Exception.Message } }
$ClaudeKey = 'claude-code:mcp-search-net'

if ($Uninstall) {
    try {
        if ($integrations.ContainsKey($ClaudeKey)) {
            $record = $integrations[$ClaudeKey]
            if ($record.ownership -eq 'managed') {
                if (-not $ClaudeExe) { throw 'CLI Claude Code introuvable pour retirer une entrée gérée.' }
                $remove = Invoke-ExternalProcess $ClaudeExe @('mcp', 'remove', '--scope', 'user', 'mcp-search-net') 15
                if (-not ($remove.Done -and $remove.ExitCode -eq 0)) {
                    throw "Suppression CLI échouée : $(Get-SafeProcessSummary $remove)"
                }
            }
            $integrations.Remove($ClaudeKey)
        }
    }
    catch { Record-MaterialFailure 'Claude Code uninstall' $_.Exception.Message }
}
elseif ($DoClaudeCode) {
    try {
        if ($ClaudeExe) {
            $alreadyManaged = $integrations.ContainsKey($ClaudeKey) -and $integrations[$ClaudeKey].ownership -eq 'managed'
            $get = Invoke-ExternalProcess $ClaudeExe @('mcp', 'get', 'mcp-search-net') 15
            $listed = Test-NativeServerOutput $get
            if ($listed -and -not $alreadyManaged) {
                $integrations[$ClaudeKey] = [PSCustomObject]@{ ownership = 'preexisting'; configuredAt = [datetime]::UtcNow.ToString('o') }
            }
            else {
                if ($alreadyManaged) {
                    $remove = Invoke-ExternalProcess $ClaudeExe @('mcp', 'remove', '--scope', 'user', 'mcp-search-net') 15
                    if (-not ($remove.Done -and $remove.ExitCode -eq 0)) {
                        throw "Migration de l'entrée gérée impossible : $(Get-SafeProcessSummary $remove)"
                    }
                    $integrations.Remove($ClaudeKey)
                }
                $payload = [ordered]@{
                    type = 'stdio'
                    command = 'cmd.exe'
                    args = @('/d', '/s', '/c', $BinLauncher)
                    env = $managedEnv
                }
                $json = $payload | ConvertTo-Json -Depth 6 -Compress
                $add = Invoke-ExternalProcess $ClaudeExe @('mcp', 'add-json', '--scope', 'user', 'mcp-search-net', $json) 20
                if (-not ($add.Done -and $add.ExitCode -eq 0)) {
                    throw "add-json échoué : $(Get-SafeProcessSummary $add)"
                }
                $verify = Invoke-ExternalProcess $ClaudeExe @('mcp', 'get', 'mcp-search-net') 15
                if (-not (Test-NativeServerOutput $verify)) {
                    $null = Invoke-ExternalProcess $ClaudeExe @('mcp', 'remove', '--scope', 'user', 'mcp-search-net') 15
                    throw "mcp get ne confirme pas le serveur : $(Get-SafeProcessSummary $verify)"
                }
                $integrations[$ClaudeKey] = [PSCustomObject]@{ ownership = 'managed'; configuredAt = [datetime]::UtcNow.ToString('o') }
            }
        }
        else { Write-Host 'Claude Code non détecté — configuration ignorée.' -ForegroundColor Yellow }
    }
    catch { Record-MaterialFailure 'Claude Code configuration' $_.Exception.Message }
}

$CopilotExe = $null
try { $CopilotExe = Resolve-CopilotExe }
catch { if ($DoCopilotCli) { Record-MaterialFailure 'Copilot CLI detection' $_.Exception.Message } }
$CopilotCliConfig = Join-Path $env:USERPROFILE '.copilot\mcp-config.json'
$CopilotCliKey = 'copilot-cli:mcp-search-net'
$CopilotCliEntry = [PSCustomObject]@{
    type = 'stdio'
    command = 'cmd.exe'
    args = @('/d', '/s', '/c', $BinLauncher)
    env = $managedEnv
    tools = @('*')
}

if ($Uninstall) {
    try { Remove-JsonMcpClient -IntegrationTable $integrations -ClientKey 'copilot-cli' -ConfigPath $CopilotCliConfig }
    catch { Record-MaterialFailure 'Copilot CLI uninstall' $_.Exception.Message }
}
elseif ($DoCopilotCli) {
    try {
        if ($CopilotExe) {
            $isPs1 = $CopilotExe.EndsWith('.ps1', [System.StringComparison]::OrdinalIgnoreCase)
            $alreadyManaged = $integrations.ContainsKey($CopilotCliKey) -and $integrations[$CopilotCliKey].ownership -eq 'managed'
            $get = Invoke-ExternalProcess $CopilotExe @('mcp', 'get', 'mcp-search-net', '--json') 15 -ViaPs5:$isPs1
            $listed = Test-NativeServerOutput $get
            if ($listed -and -not $alreadyManaged) {
                $integrations[$CopilotCliKey] = [PSCustomObject]@{
                    ownership = 'preexisting'
                    configPath = $CopilotCliConfig
                    configuredAt = [datetime]::UtcNow.ToString('o')
                }
            }
            else {
                $hadOriginal = Test-Path -LiteralPath $CopilotCliConfig -PathType Leaf
                $original = if ($hadOriginal) { [System.IO.File]::ReadAllText($CopilotCliConfig, [System.Text.Encoding]::UTF8) } else { $null }
                $data = Read-JsonFile $CopilotCliConfig
                if (-not (Get-PropertyExists $data 'mcpServers')) {
                    $data | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{}) -Force
                }
                $root = $data.mcpServers
                if ((Get-PropertyExists $root 'mcp-search-net') -and -not $alreadyManaged) {
                    $integrations[$CopilotCliKey] = [PSCustomObject]@{
                        ownership = 'preexisting'
                        configPath = $CopilotCliConfig
                        configuredAt = [datetime]::UtcNow.ToString('o')
                    }
                }
                else {
                    Backup-ConfigFile $CopilotCliConfig | Out-Null
                    $root | Add-Member -NotePropertyName 'mcp-search-net' -NotePropertyValue $CopilotCliEntry -Force
                    Write-JsonFile $CopilotCliConfig $data
                    $verify = Invoke-ExternalProcess $CopilotExe @('mcp', 'get', 'mcp-search-net', '--json') 15 -ViaPs5:$isPs1
                    if (-not (Test-NativeServerOutput $verify)) {
                        if ($hadOriginal) { Write-DurableUtf8File -Path $CopilotCliConfig -Content $original }
                        elseif (Test-Path -LiteralPath $CopilotCliConfig -PathType Leaf) { Remove-Item -LiteralPath $CopilotCliConfig -Force }
                        $integrations.Remove($CopilotCliKey)
                        throw "mcp get ne confirme pas le serveur : $(Get-SafeProcessSummary $verify)"
                    }
                    $integrations[$CopilotCliKey] = [PSCustomObject]@{
                        ownership = 'managed'
                        configPath = $CopilotCliConfig
                        configuredAt = [datetime]::UtcNow.ToString('o')
                    }
                }
            }
        }
        else { Write-Host 'Copilot CLI non détecté — configuration ignorée.' -ForegroundColor Yellow }
    }
    catch { Record-MaterialFailure 'Copilot CLI configuration' $_.Exception.Message }
}

$CodexConfigPath = Join-Path $env:USERPROFILE '.codex\config.toml'
$CodexBeginMark = '# BEGIN MCP-SEARCH-NET'
$CodexEndMark = '# END MCP-SEARCH-NET'
$CodexKey = 'codex:mcp-search-net'

function New-CodexMcpBlock {
    $argsLine = 'args = ["/d", "/s", "/c", "' + $BinLauncher.Replace('\', '\\') + '"]'
    $homeLine = 'MCP_SEARCH_HOME = "' + $InstallRoot.Replace('\', '\\') + '"'
    $configLine = 'MCP_CONFIG_PATH = "' + (Join-Path $InstallRoot 'config\application.yml').Replace('\', '\\') + '"'
    $catalogLine = 'MCP_CATALOG_PATH = "' + (Join-Path $InstallRoot 'data\catalog.db').Replace('\', '\\') + '"'
    return ($CodexBeginMark,
        '[mcp_servers.mcp-search-net]',
        'command = "cmd.exe"',
        $argsLine,
        'enabled = true',
        '',
        '[mcp_servers.mcp-search-net.env]',
        $homeLine,
        $configLine,
        $catalogLine,
        $CodexEndMark) -join [Environment]::NewLine
}

function Read-CodexConfig {
    if (Test-Path -LiteralPath $CodexConfigPath -PathType Leaf) {
        return [System.IO.File]::ReadAllText($CodexConfigPath, [System.Text.Encoding]::UTF8)
    }
    return ''
}

function Write-CodexConfig([string] $Content) {
    Write-DurableUtf8File -Path $CodexConfigPath -Content $Content
}

function Remove-CodexBlock([string] $Text) {
    $pattern = '(?s)' + [regex]::Escape($CodexBeginMark) + '.*?' + [regex]::Escape($CodexEndMark)
    return [regex]::Replace($Text, $pattern, '').Trim()
}

function Test-CodexMcpEntry([string] $Text) {
    return $Text -match '(?m)^\s*\[mcp_servers\.mcp-search-net\]\s*(?:#.*)?$'
}

if ($Uninstall) {
    try {
        if ($integrations.ContainsKey($CodexKey)) {
            $record = $integrations[$CodexKey]
            if ($record.ownership -eq 'managed') {
                $text = Read-CodexConfig
                if ($text -match [regex]::Escape($CodexBeginMark)) {
                    Backup-ConfigFile $CodexConfigPath | Out-Null
                    $cleaned = Remove-CodexBlock $text
                    Write-CodexConfig (if ($cleaned) { $cleaned + [Environment]::NewLine } else { '' })
                }
            }
            $integrations.Remove($CodexKey)
        }
    }
    catch { Record-MaterialFailure 'Codex uninstall' $_.Exception.Message }
}
elseif ($DoCodex) {
    try {
        $text = Read-CodexConfig
        $block = New-CodexMcpBlock
        if ($text -match [regex]::Escape($CodexBeginMark)) {
            $cleaned = Remove-CodexBlock $text
            $newText = if ($cleaned) { $cleaned + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine } else { $block + [Environment]::NewLine }
            if ($newText -ne $text) {
                Backup-ConfigFile $CodexConfigPath | Out-Null
                Write-CodexConfig $newText
            }
            $integrations[$CodexKey] = [PSCustomObject]@{
                ownership = 'managed'
                configPath = $CodexConfigPath
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        }
        elseif (Test-CodexMcpEntry $text) {
            Write-Host "  Codex Desktop : table 'mcp_servers.mcp-search-net' existante non gérée — préservée." -ForegroundColor Cyan
            $integrations[$CodexKey] = [PSCustomObject]@{
                ownership    = 'preexisting'
                configPath   = $CodexConfigPath
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        }
        else {
            $prefix = $text.TrimEnd()
            $newText = if ($prefix) { $prefix + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine } else { $block + [Environment]::NewLine }
            Backup-ConfigFile $CodexConfigPath | Out-Null
            Write-CodexConfig $newText
            $integrations[$CodexKey] = [PSCustomObject]@{
                ownership = 'managed'
                configPath = $CodexConfigPath
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        }
    }
    catch { Record-MaterialFailure 'Codex configuration' $_.Exception.Message }
}

try { Save-Integrations $integrations }
catch { Record-MaterialFailure 'Intégrations metadata' $_.Exception.Message }

if ($Uninstall) {
    foreach ($artifact in @('mcp.json.example', 'mcp.container.json.example')) {
        $path = Join-Path $InstallRoot $artifact
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }

    if ($MaterialFailures.Count -eq 0 -and (Test-Path -LiteralPath $IntegrationsFile -PathType Leaf)) {
        Remove-Item -LiteralPath $IntegrationsFile -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host 'Nettoyage MCP clients terminé. Les données utilisateur, .env et .config-backups sont conservés.' -ForegroundColor Green
}
else {
    Write-Host ''
    Write-Host "Configuration post-installation terminée : $InstallRoot" -ForegroundColor Green
    Write-Host "  Exemple MCP Copilot  : $(Join-Path $InstallRoot 'mcp.json.example')"
    Write-Host "  Intégrations clients : $IntegrationsFile"
}

if ($MaterialFailures.Count -gt 0) {
    Write-Host ''
    Write-Host "MCP_CONFIG_PARTIAL_FAILURE count=$($MaterialFailures.Count)" -ForegroundColor Red
    foreach ($failure in $MaterialFailures) { Write-Host "  - $failure" -ForegroundColor Red }
    exit 20
}

exit 0
