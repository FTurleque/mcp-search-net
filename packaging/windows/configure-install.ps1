[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallRoot,
    [switch] $SmokeMode,
    [switch] $Uninstall,
    # Set by the Inno Setup wizard; disables auto-detect in favour of the explicit list.
    [switch] $FromInstaller,
    # Comma-separated list of targets to configure: docker,copilot-jetbrains,copilot-cli,claude-desktop,claude-code,codex
    [string] $Clients = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InstallRoot       = [System.IO.Path]::GetFullPath($InstallRoot)
$Utf8NoBom         = New-Object System.Text.UTF8Encoding($false)
$IntegrationsFile  = Join-Path $InstallRoot 'mcp-client-integrations.json'
$BackupRoot        = Join-Path $InstallRoot '.config-backups'

# ── Helpers ────────────────────────────────────────────────────────────────────

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Read-JsonFile([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [PSCustomObject]@{} }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        if (-not $raw.Trim()) { throw 'le fichier est vide' }
        return ($raw | ConvertFrom-Json)
    } catch {
        throw "Configuration JSON invalide '$Path' : $($_.Exception.Message)"
    }
}

function Write-JsonFile([string] $Path, [object] $Data) {
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    # Use bundled Node.js for standard 2-space JSON (avoids PS5.1 deep-alignment quirks)
    # Invoke-ExternalProcess is defined later in this script but resolved at call time, not definition time
    $node = Join-Path $InstallRoot 'runtime\node-v24.18.0-win-x64\node.exe'
    if (Test-Path -LiteralPath $node -PathType Leaf) {
        $tmp = $null
        try {
            $tmp = [System.IO.Path]::GetTempFileName()
            $compressed = $Data | ConvertTo-Json -Depth 10 -Compress
            [System.IO.File]::WriteAllText($tmp, $compressed, $Utf8NoBom)
            $jsCode = "const d=require('fs').readFileSync(process.argv[1],'utf8');process.stdout.write(JSON.stringify(JSON.parse(d),null,2))"
            $r = Invoke-ExternalProcess $node @('-e', $jsCode, $tmp) 10
            if ($r.Done -and $r.ExitCode -eq 0 -and $r.Stdout) {
                [System.IO.File]::WriteAllText($Path, ($r.Stdout + "`r`n"), $Utf8NoBom)
                return
            }
        } finally {
            if ($tmp -and (Test-Path -LiteralPath $tmp -PathType Leaf)) {
                Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # Fallback: PS5.1 ConvertTo-Json with double-space normalization
    $raw  = $Data | ConvertTo-Json -Depth 10
    $json = [regex]::Replace($raw, '":\s{2,}', '": ')
    [System.IO.File]::WriteAllText($Path, ($json + "`r`n"), $Utf8NoBom)
}

function Backup-ConfigFile([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $stamp = [datetime]::UtcNow.ToString('yyyyMMddHHmmss')
    Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupRoot "$stamp-$(Split-Path $Path -Leaf)") -Force
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

function Save-Integrations([hashtable] $ht) {
    $obj = [PSCustomObject]@{}
    foreach ($k in $ht.Keys) { $obj | Add-Member -NotePropertyName $k -NotePropertyValue $ht[$k] -Force }
    Write-JsonFile $IntegrationsFile $obj
}

# Helper: run external process with timeout using System.Diagnostics.Process.
# More reliable than Start-Job in restricted/hidden installer contexts.
function Invoke-ExternalProcess {
    param(
        [string]   $Exe,
        [string[]] $ExeArgs = @(),
        [int]      $Sec     = 15,
        [switch]   $ViaPs5     # wrap in powershell.exe -File (for .ps1 scripts)
    )
    $ps5      = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $realExe  = if ($ViaPs5) { $ps5 } else { $Exe }
    $realArgs = if ($ViaPs5) {
        @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Exe) + $ExeArgs
    } else { $ExeArgs }
    $argStr = ($realArgs | ForEach-Object {
        if ($_ -match '[ "]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    }) -join ' '

    $psi                        = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = $realExe
    $psi.Arguments              = $argStr
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true

    try {
        $proc     = [System.Diagnostics.Process]::Start($psi)
        $outTask  = $proc.StandardOutput.ReadToEndAsync()
        $errTask  = $proc.StandardError.ReadToEndAsync()
        $finished = $proc.WaitForExit($Sec * 1000)
        if (-not $finished) { try { $proc.Kill() } catch {} }
        [System.Threading.Tasks.Task]::WhenAll($outTask, $errTask).Wait(3000) | Out-Null
        $stdout   = if ($outTask.IsCompleted) { $outTask.Result } else { '' }
        $stderr   = if ($errTask.IsCompleted) { $errTask.Result } else { '' }
        $exitCode = if ($finished) { try { $proc.ExitCode } catch { -1 } } else { -1 }
        $proc.Dispose()
        return [PSCustomObject]@{ Stdout = $stdout; Stderr = $stderr; Out = ($stdout + $stderr); Done = $finished; ExitCode = $exitCode }
    } catch {
        return [PSCustomObject]@{ Stdout = ''; Stderr = ''; Out = ''; Done = $false; ExitCode = -1 }
    }
}

# ── .env generation ────────────────────────────────────────────────────────────

$EnvFile = Join-Path $InstallRoot '.env'
if (-not $Uninstall -and -not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    $crawl4aiToken = New-LocalSecret
    $searxngSecret = New-LocalSecret
    $envContent    = @(
        '# Secrets générés localement par l''installateur. Ne pas commiter ce fichier.'
        "CRAWL4AI_API_TOKEN=$crawl4aiToken"
        "MCP_CRAWL4AI_TOKEN=$crawl4aiToken"
        "SEARXNG_SECRET=$searxngSecret"
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($EnvFile, $envContent + "`r`n", $Utf8NoBom)
    Write-Host "Secrets fournisseurs locaux générés : $EnvFile"
}

if ($SmokeMode) { exit 0 }

# ── Client selection ───────────────────────────────────────────────────────────
# -FromInstaller: honour explicit wizard selection; empty list = nothing to configure.
# Otherwise (ZIP install.ps1): attempt all targets, skip if not detected.
$AllClients = @('docker', 'copilot-jetbrains', 'copilot-cli', 'claude-desktop', 'claude-code', 'codex')
if ($FromInstaller) {
    $clientList = if ($Clients) { @($Clients -split ',' | ForEach-Object { $_.Trim() }) } else { @() }
} else {
    $clientList = $AllClients
}
$DoDocker        = -not $Uninstall -and ($clientList -contains 'docker')
$DoCopilotJB     = $clientList -contains 'copilot-jetbrains'
$DoCopilotCli    = $clientList -contains 'copilot-cli'
$DoClaudeDesktop = $clientList -contains 'claude-desktop'
$DoClaudeCode    = $clientList -contains 'claude-code'
$DoCodex         = $clientList -contains 'codex'

# ── Compose normalization (distribution layout: docker\ → root) ────────────────
# CMD launchers reference %MCP_SEARCH_HOME%\compose.yaml; copy from docker\ if needed
if (-not $Uninstall) {
    foreach ($f in @('compose.yaml', 'compose.hybrid.yaml')) {
        $src = Join-Path $InstallRoot "docker\$f"
        $dst = Join-Path $InstallRoot $f
        if ((Test-Path -LiteralPath $src -PathType Leaf) -and (-not (Test-Path -LiteralPath $dst -PathType Leaf))) {
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
}

# ── mcp.json.example generation ────────────────────────────────────────────────

$BinLauncher       = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$ContainerLauncher = Join-Path $InstallRoot 'bin\mcp-search-net-container.cmd'

if (-not $Uninstall) {
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
    Write-JsonFile (Join-Path $InstallRoot 'mcp.json.example') $McpExample

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
    Write-JsonFile (Join-Path $InstallRoot 'mcp.container.json.example') $ContainerExample
}

# ── Docker service startup ──────────────────────────────────────────────────────

if ($DoDocker) {
    try {
        $ComposePath = $null
        foreach ($c in @((Join-Path $InstallRoot 'compose.yaml'), (Join-Path $InstallRoot 'docker\compose.yaml'))) {
            if (Test-Path -LiteralPath $c -PathType Leaf) { $ComposePath = $c; break }
        }

        $DockerCmd = Get-Command docker -ErrorAction SilentlyContinue
        if ($DockerCmd -and $ComposePath) {
            Write-Host ''
            Write-Host 'Vérification de Docker...'
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $null = & $DockerCmd.Source info 2>&1
            $isRunning = $LASTEXITCODE -eq 0
            $ErrorActionPreference = $prev

            if ($isRunning) {
                Write-Host 'Démarrage des services SearXNG et Crawl4AI...'
                $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                & $DockerCmd.Source compose --env-file $EnvFile -p mcp-search-net -f $ComposePath up -d searxng crawl4ai 2>&1 |
                    ForEach-Object { Write-Host "  $_" }
                $dockerExit = $LASTEXITCODE
                $ErrorActionPreference = $prev

                if ($dockerExit -eq 0) {
                    Write-Host 'Services Docker démarrés (SearXNG + Crawl4AI) — restart: unless-stopped' -ForegroundColor Green
                } else {
                    Write-Host "Services Docker : démarrage incomplet (code $dockerExit)." -ForegroundColor Yellow
                    Write-Host "  Lancez manuellement : docker compose -f '$ComposePath' up -d searxng crawl4ai" -ForegroundColor Yellow
                }
            } else {
                Write-Host 'Docker Desktop non démarré — lancez Docker Desktop, puis :' -ForegroundColor Yellow
                Write-Host "  docker compose -f '$ComposePath' up -d searxng crawl4ai" -ForegroundColor Yellow
            }
        } elseif (-not $DockerCmd) {
            Write-Host 'Docker absent du PATH — installez Docker Desktop pour démarrer SearXNG et Crawl4AI.' -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Docker : erreur lors du démarrage: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── Docker service shutdown (uninstall) ────────────────────────────────────────

if ($Uninstall) {
    try {
        $ComposePath = $null
        foreach ($c in @((Join-Path $InstallRoot 'compose.yaml'), (Join-Path $InstallRoot 'docker\compose.yaml'))) {
            if (Test-Path -LiteralPath $c -PathType Leaf) { $ComposePath = $c; break }
        }
        $DockerCmd = Get-Command docker -ErrorAction SilentlyContinue
        if ($DockerCmd -and $ComposePath) {
            Write-Host ''
            Write-Host 'Arrêt des services Docker (SearXNG + Crawl4AI)...'
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $null = & $DockerCmd.Source info 2>&1
            $isRunning = $LASTEXITCODE -eq 0
            $ErrorActionPreference = $prev
            if ($isRunning) {
                $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                & $DockerCmd.Source compose -p mcp-search-net down --remove-orphans 2>&1 |
                    ForEach-Object { Write-Host "  $_" }
                $dockerExit = $LASTEXITCODE
                $ErrorActionPreference = $prev
                if ($dockerExit -eq 0) {
                    Write-Host 'Services Docker arrêtés et supprimés.' -ForegroundColor Green
                } else {
                    Write-Host "Docker down incomplet (code $dockerExit) — arrêtez manuellement si nécessaire." -ForegroundColor Yellow
                }
            } else {
                Write-Host 'Docker non démarré — aucun service à arrêter.' -ForegroundColor Cyan
            }
        } elseif (-not $DockerCmd) {
            Write-Host 'Docker absent du PATH — services déjà arrêtés ou jamais démarrés.' -ForegroundColor Cyan
        }
    } catch {
        Write-Host "  Docker : erreur lors de l'arrêt: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── MCP client wiring ──────────────────────────────────────────────────────────

$integrations = Load-Integrations

# Entry for Copilot JetBrains: root key "servers", type "stdio", no tools field
$JetBrainsEntry = [PSCustomObject]@{
    type    = 'stdio'
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = [PSCustomObject]@{ MCP_SEARCH_HOME = $InstallRoot }
}
# Claude Desktop uses mcpServers root, no type/tools fields
$DesktopEntry = [PSCustomObject]@{
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = [PSCustomObject]@{ MCP_SEARCH_HOME = $InstallRoot }
}

function Install-JsonMcpClient {
    param(
        [string] $ClientKey,
        [string] $ConfigPath,
        [pscustomobject] $Entry,
        [string] $RootKey = 'mcpServers',
        [string] $ServerKey = 'mcp-search-net'
    )

    $integKey = "${ClientKey}:${ServerKey}"
    $alreadyManaged = $integrations.ContainsKey($integKey) -and
                      $integrations[$integKey].ownership -eq 'managed'

    $data = Read-JsonFile $ConfigPath
    if (-not (Get-PropertyExists $data $RootKey)) {
        $data | Add-Member -NotePropertyName $RootKey -NotePropertyValue ([PSCustomObject]@{}) -Force
    }
    $root = $data.$RootKey

    if ((Get-PropertyExists $root $ServerKey) -and -not $alreadyManaged) {
        Write-Host "  $ClientKey : entrée '$ServerKey' existante non gérée — préservée." -ForegroundColor Cyan
        $integrations[$integKey] = [PSCustomObject]@{
            ownership    = 'preexisting'
            configPath   = $ConfigPath
            configuredAt = [datetime]::UtcNow.ToString('o')
        }
        return
    }

    Backup-ConfigFile $ConfigPath
    $root | Add-Member -NotePropertyName $ServerKey -NotePropertyValue $Entry -Force
    Write-JsonFile $ConfigPath $data
    Write-Host "  $ClientKey : '$ServerKey' configuré -> $ConfigPath" -ForegroundColor Green
    $integrations[$integKey] = [PSCustomObject]@{
        ownership    = 'managed'
        configPath   = $ConfigPath
        configuredAt = [datetime]::UtcNow.ToString('o')
    }
}

function Remove-JsonMcpClient {
    param(
        [string] $ClientKey,
        [string] $ConfigPath = '',
        [string] $ServerKey = 'mcp-search-net'
    )
    $integKey = "${ClientKey}:${ServerKey}"
    if (-not $integrations.ContainsKey($integKey)) {
        Write-Host "  $ClientKey : entrée non suivie par cet installateur — préservée." -ForegroundColor Cyan
        return
    }

    $rec = $integrations[$integKey]
    if ($rec.ownership -ne 'managed') {
        Write-Host "  $ClientKey : entrée préexistante/non gérée — préservée." -ForegroundColor Cyan
        $integrations.Remove($integKey)
        return
    }

    $resolvedPath = $ConfigPath
    if (Get-PropertyExists $rec 'configPath') { $resolvedPath = $rec.configPath }
    if ($resolvedPath -and (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        $data     = Read-JsonFile $resolvedPath
        $rootKeys = @('mcpServers', 'servers')
        foreach ($rk in $rootKeys) {
            if ((Get-PropertyExists $data $rk) -and (Get-PropertyExists $data.$rk $ServerKey)) {
                Backup-ConfigFile $resolvedPath
                $data.$rk.PSObject.Properties.Remove($ServerKey)
                Write-JsonFile $resolvedPath $data
                Write-Host "  $ClientKey : '$ServerKey' retiré de $resolvedPath" -ForegroundColor Green
                break
            }
        }
    }
    $integrations.Remove($integKey)
}

# ── GitHub Copilot (JetBrains / IntelliJ) ─────────────────────────────────────

$CopilotJBDir    = Join-Path $env:LOCALAPPDATA 'github-copilot\intellij'
$CopilotJBConfig = Join-Path $CopilotJBDir 'mcp.json'
if ($Uninstall) {
    try { Remove-JsonMcpClient 'copilot-jetbrains' $CopilotJBConfig } catch {
        Write-Host "  Copilot JetBrains : erreur lors de la suppression: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} elseif ($DoCopilotJB) {
    try {
        if (Test-Path -LiteralPath $CopilotJBDir -PathType Container) {
            Write-Host ''
            Write-Host 'Copilot JetBrains détecté.'
            Install-JsonMcpClient `
                -ClientKey  'copilot-jetbrains' `
                -ConfigPath $CopilotJBConfig `
                -Entry      $JetBrainsEntry `
                -RootKey    'servers'
            # Nettoyer uniquement une ancienne entrée incorrecte qui pointe clairement vers cette installation.
            $jbData = Read-JsonFile $CopilotJBConfig
            if ((Get-PropertyExists $jbData 'mcpServers') -and (Get-PropertyExists $jbData.mcpServers 'mcp-search-net')) {
                $legacyEntry = $jbData.mcpServers.'mcp-search-net'
                $legacyOwned = $false
                if ((Get-PropertyExists $legacyEntry 'env') -and
                    (Get-PropertyExists $legacyEntry.env 'MCP_SEARCH_HOME') -and
                    $legacyEntry.env.MCP_SEARCH_HOME -eq $InstallRoot) {
                    $legacyOwned = $true
                }
                if ((Get-PropertyExists $legacyEntry 'args') -and (($legacyEntry.args -join ' ') -like "*$BinLauncher*")) {
                    $legacyOwned = $true
                }
                if ($legacyOwned) {
                    Backup-ConfigFile $CopilotJBConfig
                    $jbData.mcpServers.PSObject.Properties.Remove('mcp-search-net')
                    $hasOtherKeys = [bool]($jbData.mcpServers.PSObject.Properties | Select-Object -First 1)
                    if (-not $hasOtherKeys) {
                        $jbData.PSObject.Properties.Remove('mcpServers')
                    }
                    Write-JsonFile $CopilotJBConfig $jbData
                    Write-Host '  Copilot JetBrains : ancienne entrée mcpServers gérée supprimée.' -ForegroundColor Cyan
                } else {
                    Write-Host '  Copilot JetBrains : ancienne entrée mcpServers non gérée — préservée.' -ForegroundColor Cyan
                }
            }
        } else {
            Write-Host '  Copilot JetBrains : non détecté (github-copilot\intellij absent). Configuration ignorée.' -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Copilot JetBrains : erreur lors de la configuration: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── Claude Desktop ─────────────────────────────────────────────────────────────

$ClaudeDesktopConfig = $null
try {
    $PackagesDir = Join-Path $env:LOCALAPPDATA 'Packages'
    if (Test-Path -LiteralPath $PackagesDir -PathType Container) {
        $pkgs = Get-ChildItem -LiteralPath $PackagesDir -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue
        foreach ($pkg in $pkgs) {
            $candidate = Join-Path $pkg.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'
            $dir = Split-Path $candidate -Parent
            if (Test-Path -LiteralPath $dir -PathType Container) {
                $ClaudeDesktopConfig = $candidate; break
            }
        }
    }
    if (-not $ClaudeDesktopConfig) {
        $fallback = Join-Path $env:APPDATA 'Claude'
        if (Test-Path -LiteralPath $fallback -PathType Container) {
            $ClaudeDesktopConfig = Join-Path $fallback 'claude_desktop_config.json'
        }
    }
} catch {
    Write-Host "  Claude Desktop : erreur lors de la détection: $($_.Exception.Message)" -ForegroundColor Yellow
}

if ($Uninstall) {
    try { Remove-JsonMcpClient 'claude-desktop' $ClaudeDesktopConfig } catch {
        Write-Host "  Claude Desktop : erreur lors de la suppression: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} elseif ($DoClaudeDesktop) {
    try {
        if ($ClaudeDesktopConfig) {
            Write-Host ''
            Write-Host 'Claude Desktop détecté.'
            Install-JsonMcpClient `
                -ClientKey  'claude-desktop' `
                -ConfigPath $ClaudeDesktopConfig `
                -Entry      $DesktopEntry `
                -RootKey    'mcpServers'
        } else {
            Write-Host '  Claude Desktop : non détecté (%APPDATA%\Claude absent). Configuration ignorée.' -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Claude Desktop : erreur lors de la configuration: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── Claude Code (CLI) ──────────────────────────────────────────────────────────

$ClaudeExe = $null
try {
    $claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($claudeCmd) { $ClaudeExe = $claudeCmd.Source }
    if (-not $ClaudeExe) {
        # Claude Code Desktop embeds its own CLI under %APPDATA%\Claude\claude-code
        $claudeCodeDir = Join-Path $env:APPDATA 'Claude\claude-code'
        if (Test-Path -LiteralPath $claudeCodeDir -PathType Container) {
            $embedded = Get-ChildItem -LiteralPath $claudeCodeDir -Recurse -Filter 'claude.exe' -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($embedded) { $ClaudeExe = $embedded.FullName }
        }
    }
} catch {
    Write-Host "  Claude Code : erreur lors de la détection: $($_.Exception.Message)" -ForegroundColor Yellow
}

$integKeyCC = 'claude-code:mcp-search-net'
if ($Uninstall) {
    try {
        if ($integrations.ContainsKey($integKeyCC) -and $integrations[$integKeyCC].ownership -eq 'managed') {
            if ($ClaudeExe) {
                $rRm = Invoke-ExternalProcess $ClaudeExe @('mcp', 'remove', '--scope', 'user', 'mcp-search-net') 15
                if ($rRm.Done -and $rRm.ExitCode -eq 0) {
                    Write-Host '  Claude Code : mcp-search-net retiré (scope=user).' -ForegroundColor Green
                } else {
                    Write-Host '  Claude Code : suppression incomplète — retirez manuellement si nécessaire.' -ForegroundColor Yellow
                }
            }
            $integrations.Remove($integKeyCC)
        }
    } catch {
        Write-Host "  Claude Code : erreur lors de la suppression: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} elseif ($DoClaudeCode) {
    try {
        if ($ClaudeExe) {
            Write-Host ''
            Write-Host 'Claude Code détecté.'
            $alreadyManaged = $integrations.ContainsKey($integKeyCC) -and $integrations[$integKeyCC].ownership -eq 'managed'

            $rList   = Invoke-ExternalProcess $ClaudeExe @('mcp', 'list') 10
            $listOut = $rList.Out

            if ($listOut -match 'mcp-search-net' -and -not $alreadyManaged) {
                Write-Host "  Claude Code : entrée 'mcp-search-net' existante non gérée — préservée." -ForegroundColor Cyan
                $integrations[$integKeyCC] = [PSCustomObject]@{
                    ownership    = 'preexisting'
                    configuredAt = [datetime]::UtcNow.ToString('o')
                }
            } else {
                $rAdd   = Invoke-ExternalProcess $ClaudeExe @('mcp', 'add', '--scope', 'user', '-e', "MCP_SEARCH_HOME=$InstallRoot", 'mcp-search-net', '--', 'cmd.exe', '/d', '/s', '/c', $BinLauncher) 20
                $ccExit = $rAdd.ExitCode
                if ($rAdd.Done -and $ccExit -eq 0) {
                    Write-Host "  Claude Code : 'mcp-search-net' configuré (scope=user)" -ForegroundColor Green
                    $integrations[$integKeyCC] = [PSCustomObject]@{
                        ownership    = 'managed'
                        configuredAt = [datetime]::UtcNow.ToString('o')
                    }
                } else {
                    Write-Host "  Claude Code : configuration échouée (code $ccExit)" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host '  Claude Code : CLI non détecté (claude absent du PATH et %APPDATA%\Claude\claude-code absent).' -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Claude Code : erreur lors de la configuration: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── GitHub Copilot CLI ─────────────────────────────────────────────────────────

$CopilotExe = $null
try {
    $copilotCmd = Get-Command copilot -ErrorAction SilentlyContinue
    if ($copilotCmd -and $copilotCmd.CommandType -in @('Application', 'ExternalScript')) {
        $CopilotExe = $copilotCmd.Source
    }
} catch {
    Write-Host "  Copilot CLI : erreur lors de la détection: $($_.Exception.Message)" -ForegroundColor Yellow
}

$integKeyCopilotCli = 'copilot-cli:mcp-search-net'
if ($Uninstall) {
    try {
        if ($integrations.ContainsKey($integKeyCopilotCli) -and $integrations[$integKeyCopilotCli].ownership -eq 'managed') {
            if ($CopilotExe) {
                $isPs1 = $CopilotExe.EndsWith('.ps1', [System.StringComparison]::OrdinalIgnoreCase)
                $rRm   = Invoke-ExternalProcess $CopilotExe @('mcp', 'remove', 'mcp-search-net') 15 -ViaPs5:$isPs1
                if ($rRm.Done) { Write-Host '  Copilot CLI : mcp-search-net retiré.' -ForegroundColor Green }
                else            { Write-Host '  Copilot CLI : délai dépassé lors de la suppression — retirez manuellement.' -ForegroundColor Yellow }
            }
            $integrations.Remove($integKeyCopilotCli)
        }
    } catch {
        Write-Host "  Copilot CLI : erreur lors de la suppression: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} elseif ($DoCopilotCli) {
    try {
        if ($CopilotExe) {
            Write-Host ''
            Write-Host 'GitHub Copilot CLI détecté.'
            $isPs1          = $CopilotExe.EndsWith('.ps1', [System.StringComparison]::OrdinalIgnoreCase)
            $alreadyManaged = $integrations.ContainsKey($integKeyCopilotCli) -and $integrations[$integKeyCopilotCli].ownership -eq 'managed'

            $rList   = Invoke-ExternalProcess $CopilotExe @('mcp', 'list') 10 -ViaPs5:$isPs1
            $listOut = $rList.Out

            if ($listOut -match 'mcp-search-net' -and -not $alreadyManaged) {
                Write-Host "  Copilot CLI : entrée 'mcp-search-net' existante non gérée — préservée." -ForegroundColor Cyan
                $integrations[$integKeyCopilotCli] = [PSCustomObject]@{
                    ownership    = 'preexisting'
                    configuredAt = [datetime]::UtcNow.ToString('o')
                }
            } else {
                $rAdd = Invoke-ExternalProcess $CopilotExe @('mcp', 'add', '-e', "MCP_SEARCH_HOME=$InstallRoot", 'mcp-search-net', '--', 'cmd.exe', '/d', '/s', '/c', $BinLauncher) 20 -ViaPs5:$isPs1
                if (-not $rAdd.Done) {
                    Write-Host '  Copilot CLI : délai dépassé lors de la configuration.' -ForegroundColor Yellow
                } elseif ($rAdd.ExitCode -eq 0) {
                    Write-Host "  Copilot CLI : 'mcp-search-net' configuré" -ForegroundColor Green
                    $integrations[$integKeyCopilotCli] = [PSCustomObject]@{
                        ownership    = 'managed'
                        configuredAt = [datetime]::UtcNow.ToString('o')
                    }
                } else {
                    Write-Host "  Copilot CLI : configuration échouée (code $($rAdd.ExitCode))" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host '  Copilot CLI : non détecté. Configuration ignorée.' -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Copilot CLI : erreur lors de la configuration: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── Codex Desktop ──────────────────────────────────────────────────────────────

$CodexConfigPath = Join-Path $env:USERPROFILE '.codex\config.toml'
$CodexBeginMark  = '# BEGIN MCP-SEARCH-NET'
$CodexEndMark    = '# END MCP-SEARCH-NET'
$integKeyCodex   = 'codex:mcp-search-net'

function New-CodexMcpBlock {
    # Use distinct names to avoid shadowing PS automatic variables ($args, $home)
    $cmdLine  = 'command = "cmd.exe"'
    $argsLine = 'args = ["/d", "/s", "/c", "' + $BinLauncher.Replace('\', '\\') + '"]'
    $envLine  = 'MCP_SEARCH_HOME = "' + $InstallRoot.Replace('\', '\\') + '"'
    return ($CodexBeginMark,
            '[mcp_servers.mcp-search-net]',
            $cmdLine, $argsLine, 'enabled = true', '',
            '[mcp_servers.mcp-search-net.env]',
            $envLine,
            $CodexEndMark) -join [Environment]::NewLine
}

function Read-CodexConfig {
    if (Test-Path -LiteralPath $CodexConfigPath -PathType Leaf) {
        return [System.IO.File]::ReadAllText($CodexConfigPath, [System.Text.Encoding]::UTF8)
    }
    return ''
}

function Write-CodexConfig([string] $Content) {
    New-Item -ItemType Directory -Force -Path (Split-Path $CodexConfigPath -Parent) | Out-Null
    [System.IO.File]::WriteAllText($CodexConfigPath, $Content, $Utf8NoBom)
}

function Remove-CodexBlock([string] $Text) {
    $pat = '(?s)' + [regex]::Escape($CodexBeginMark) + '.*?' + [regex]::Escape($CodexEndMark)
    return [regex]::Replace($Text, $pat, '').Trim()
}

function Test-CodexMcpEntry([string] $Text) {
    return $Text -match '(?m)^\s*\[mcp_servers\.mcp-search-net\]\s*(?:#.*)?$'
}

if ($Uninstall) {
    try {
        if ($integrations.ContainsKey($integKeyCodex)) {
            $record = $integrations[$integKeyCodex]
            if ($record.ownership -eq 'managed') {
                $text = Read-CodexConfig
                if ($text -match [regex]::Escape($CodexBeginMark)) {
                    Backup-ConfigFile $CodexConfigPath
                    $cleaned = Remove-CodexBlock $text
                    Write-CodexConfig (if ($cleaned) { $cleaned + [Environment]::NewLine } else { '' })
                    Write-Host '  Codex Desktop : mcp-search-net retiré de config.toml' -ForegroundColor Green
                }
            } else {
                Write-Host '  Codex Desktop : entrée préexistante/non gérée — préservée.' -ForegroundColor Cyan
            }
            $integrations.Remove($integKeyCodex)
        }
    } catch {
        Write-Host "  Codex Desktop : erreur lors de la suppression: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} elseif ($DoCodex) {
    try {
        Write-Host ''
        Write-Host 'Codex Desktop : configuration de mcp-search-net...'
        $text  = Read-CodexConfig
        $block = New-CodexMcpBlock
        if ($text -match [regex]::Escape($CodexBeginMark)) {
            $cleaned = Remove-CodexBlock $text
            $newText = if ($cleaned) { $cleaned + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine } else { $block + [Environment]::NewLine }
            if ($newText -ne $text) {
                Backup-ConfigFile $CodexConfigPath
                Write-CodexConfig $newText
                Write-Host '  Codex Desktop : mcp-search-net mis à jour dans config.toml' -ForegroundColor Green
            } else {
                Write-Host '  Codex Desktop : configuration déjà à jour.' -ForegroundColor Cyan
            }
            $integrations[$integKeyCodex] = [PSCustomObject]@{
                ownership    = 'managed'
                configPath   = $CodexConfigPath
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        } elseif (Test-CodexMcpEntry $text) {
            Write-Host "  Codex Desktop : table 'mcp_servers.mcp-search-net' existante non gérée — préservée." -ForegroundColor Cyan
            $integrations[$integKeyCodex] = [PSCustomObject]@{
                ownership    = 'preexisting'
                configPath   = $CodexConfigPath
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        } else {
            $prefix  = $text.TrimEnd()
            $newText = if ($prefix) { $prefix + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine } else { $block + [Environment]::NewLine }
            Backup-ConfigFile $CodexConfigPath
            Write-CodexConfig $newText
            Write-Host '  Codex Desktop : mcp-search-net configuré dans config.toml' -ForegroundColor Green
            $integrations[$integKeyCodex] = [PSCustomObject]@{
                ownership    = 'managed'
                configPath   = $CodexConfigPath
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        }
    } catch {
        Write-Host "  Codex Desktop : erreur lors de la configuration: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── Persist integrations ───────────────────────────────────────────────────────

try {
    Save-Integrations $integrations
} catch {
    Write-Host "  Intégrations : erreur lors de la sauvegarde: $($_.Exception.Message)" -ForegroundColor Yellow
}

if ($Uninstall) {
    Write-Host ''
    Write-Host 'Nettoyage MCP clients terminé.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host "Configuration post-installation terminée : $InstallRoot" -ForegroundColor Green
    Write-Host "  Exemple MCP Copilot  : $(Join-Path $InstallRoot 'mcp.json.example')"
    Write-Host "  Intégrations clients : $IntegrationsFile"
}

# exit 0 explicite : sans ca, $LASTEXITCODE d'une commande native precedente (ex. docker info)
# reste visible pour l'appelant (install.ps1) et ferait croire a un echec.
exit 0