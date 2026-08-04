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
        if ($raw.Trim()) { return ($raw | ConvertFrom-Json) }
    } catch {}
    return [PSCustomObject]@{}
}

function Write-JsonFile([string] $Path, [object] $Data) {
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, (($Data | ConvertTo-Json -Depth 10) + "`r`n"), $Utf8NoBom)
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
}

# ── MCP client wiring ──────────────────────────────────────────────────────────

$integrations = Load-Integrations

# Entry for JSON-based clients (Copilot JetBrains, Claude Desktop)
$LocalEntry = [PSCustomObject]@{
    type    = 'local'
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = [PSCustomObject]@{ MCP_SEARCH_HOME = $InstallRoot }
    tools   = @('*')
}
# Claude Desktop uses a simpler schema (no type/tools)
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
    Write-Host "  $ClientKey : '$ServerKey' configuré → $ConfigPath" -ForegroundColor Green
    $integrations[$integKey] = [PSCustomObject]@{
        ownership    = 'managed'
        configPath   = $ConfigPath
        configuredAt = [datetime]::UtcNow.ToString('o')
    }
}

function Remove-JsonMcpClient {
    param(
        [string] $ClientKey,
        [string] $ServerKey = 'mcp-search-net'
    )
    $integKey = "${ClientKey}:${ServerKey}"
    if (-not $integrations.ContainsKey($integKey)) { return }
    $rec = $integrations[$integKey]
    if ($rec.ownership -ne 'managed') {
        Write-Host "  $ClientKey : entrée non gérée par cet installeur — non touchée." -ForegroundColor Cyan
        return
    }
    $configPath = $rec.configPath
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return }

    $data = Read-JsonFile $configPath
    $rootKeys = @('mcpServers', 'servers')
    foreach ($rk in $rootKeys) {
        if ((Get-PropertyExists $data $rk) -and (Get-PropertyExists $data.$rk $ServerKey)) {
            Backup-ConfigFile $configPath
            $data.$rk.PSObject.Properties.Remove($ServerKey)
            Write-JsonFile $configPath $data
            Write-Host "  $ClientKey : '$ServerKey' retiré de $configPath" -ForegroundColor Green
            break
        }
    }
    $integrations.Remove($integKey)
}

# ── GitHub Copilot (JetBrains / IntelliJ) ─────────────────────────────────────

$CopilotJBDir = Join-Path $env:LOCALAPPDATA 'github-copilot\intellij'
if ($Uninstall) {
    Remove-JsonMcpClient 'copilot-jetbrains'
} elseif ($DoCopilotJB) {
    if (Test-Path -LiteralPath $CopilotJBDir -PathType Container) {
        Write-Host ''
        Write-Host 'Copilot JetBrains détecté.'
        Install-JsonMcpClient `
            -ClientKey  'copilot-jetbrains' `
            -ConfigPath (Join-Path $CopilotJBDir 'mcp.json') `
            -Entry      $LocalEntry `
            -RootKey    'mcpServers'
    } else {
        Write-Host '  Copilot JetBrains : non détecté (github-copilot\intellij absent). Configuration ignorée.' -ForegroundColor Yellow
    }
}

# ── Claude Desktop ─────────────────────────────────────────────────────────────

$ClaudeDesktopConfig = $null
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

if ($Uninstall) {
    Remove-JsonMcpClient 'claude-desktop'
} elseif ($DoClaudeDesktop) {
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
}

# ── Claude Code (CLI) ──────────────────────────────────────────────────────────

$ClaudeExe = $null
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

$integKeyCC = 'claude-code:mcp-search-net'
if ($Uninstall) {
    if ($integrations.ContainsKey($integKeyCC) -and $integrations[$integKeyCC].ownership -eq 'managed') {
        if ($ClaudeExe) {
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $ClaudeExe mcp remove --scope user mcp-search-net 2>&1 | Out-Null
            $ErrorActionPreference = $prev
            Write-Host '  Claude Code : mcp-search-net retiré (scope=user).' -ForegroundColor Green
        }
        $integrations.Remove($integKeyCC)
    }
} elseif ($DoClaudeCode) {
    if ($ClaudeExe) {
        Write-Host ''
        Write-Host 'Claude Code détecté.'
        $alreadyManaged = $integrations.ContainsKey($integKeyCC) -and $integrations[$integKeyCC].ownership -eq 'managed'

        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $listOut = & $ClaudeExe mcp list 2>&1 | Out-String
        $ErrorActionPreference = $prev

        if ($listOut -match 'mcp-search-net' -and -not $alreadyManaged) {
            Write-Host "  Claude Code : entrée 'mcp-search-net' existante non gérée — préservée." -ForegroundColor Cyan
            $integrations[$integKeyCC] = [PSCustomObject]@{
                ownership    = 'preexisting'
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        } else {
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $ClaudeExe mcp add --scope user -e "MCP_SEARCH_HOME=$InstallRoot" mcp-search-net -- cmd.exe /d /s /c $BinLauncher 2>&1 | Out-Null
            $ccExit = $LASTEXITCODE
            $ErrorActionPreference = $prev

            if ($ccExit -eq 0) {
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
}

# ── GitHub Copilot CLI ─────────────────────────────────────────────────────────

$CopilotExe = $null
$copilotCmd = Get-Command copilot -ErrorAction SilentlyContinue
if ($copilotCmd -and $copilotCmd.CommandType -eq 'Application') {
    $p = $copilotCmd.Source.ToLowerInvariant()
    if (-not ($p -like '*microsoft vs code*') -and -not ($p -like '*code\bin*') -and -not ($p -like '*vscode*\bin*')) {
        $CopilotExe = $copilotCmd.Source
    }
}

$integKeyCopilotCli = 'copilot-cli:mcp-search-net'
if ($Uninstall) {
    if ($integrations.ContainsKey($integKeyCopilotCli) -and $integrations[$integKeyCopilotCli].ownership -eq 'managed') {
        if ($CopilotExe) {
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $CopilotExe mcp remove mcp-search-net 2>&1 | Out-Null
            $ErrorActionPreference = $prev
            Write-Host '  Copilot CLI : mcp-search-net retiré.' -ForegroundColor Green
        }
        $integrations.Remove($integKeyCopilotCli)
    }
} elseif ($DoCopilotCli) {
    if ($CopilotExe) {
        Write-Host ''
        Write-Host 'GitHub Copilot CLI détecté.'
        $alreadyManaged = $integrations.ContainsKey($integKeyCopilotCli) -and $integrations[$integKeyCopilotCli].ownership -eq 'managed'
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $listOut = & $CopilotExe mcp list 2>&1 | Out-String
        $ErrorActionPreference = $prev
        if ($listOut -match 'mcp-search-net' -and -not $alreadyManaged) {
            Write-Host "  Copilot CLI : entrée 'mcp-search-net' existante non gérée — préservée." -ForegroundColor Cyan
            $integrations[$integKeyCopilotCli] = [PSCustomObject]@{
                ownership    = 'preexisting'
                configuredAt = [datetime]::UtcNow.ToString('o')
            }
        } else {
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $CopilotExe mcp add -e "MCP_SEARCH_HOME=$InstallRoot" mcp-search-net -- cmd.exe /d /s /c $BinLauncher 2>&1 | Out-Null
            $cliExit = $LASTEXITCODE
            $ErrorActionPreference = $prev
            if ($cliExit -eq 0) {
                Write-Host "  Copilot CLI : 'mcp-search-net' configuré" -ForegroundColor Green
                $integrations[$integKeyCopilotCli] = [PSCustomObject]@{
                    ownership    = 'managed'
                    configuredAt = [datetime]::UtcNow.ToString('o')
                }
            } else {
                Write-Host "  Copilot CLI : configuration échouée (code $cliExit)" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host '  Copilot CLI : non détecté. Configuration ignorée.' -ForegroundColor Yellow
    }
}

# ── Codex Desktop ──────────────────────────────────────────────────────────────

$CodexConfigPath = Join-Path $env:USERPROFILE '.codex\config.toml'
$CodexBeginMark  = '# BEGIN MCP-SEARCH-NET'
$CodexEndMark    = '# END MCP-SEARCH-NET'
$integKeyCodex   = 'codex:mcp-search-net'

function New-CodexMcpBlock {
    $cmd  = 'command = "cmd.exe"'
    $args = 'args = ["/d", "/s", "/c", "' + $BinLauncher.Replace('\', '\\') + '"]'
    $home = 'MCP_SEARCH_HOME = "' + $InstallRoot.Replace('\', '\\') + '"'
    return ($CodexBeginMark,
            '[mcp_servers.mcp-search-net]',
            $cmd, $args, 'enabled = true', '',
            '[mcp_servers.mcp-search-net.env]',
            $home,
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

if ($Uninstall) {
    if ($integrations.ContainsKey($integKeyCodex) -and $integrations[$integKeyCodex].ownership -eq 'managed') {
        $text = Read-CodexConfig
        if ($text -match [regex]::Escape($CodexBeginMark)) {
            Backup-ConfigFile $CodexConfigPath
            $cleaned = Remove-CodexBlock $text
            Write-CodexConfig (if ($cleaned) { $cleaned + [Environment]::NewLine } else { '' })
            Write-Host '  Codex Desktop : mcp-search-net retiré de config.toml' -ForegroundColor Green
        }
        $integrations.Remove($integKeyCodex)
    }
} elseif ($DoCodex) {
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
    } else {
        $prefix  = $text.TrimEnd()
        $newText = if ($prefix) { $prefix + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine } else { $block + [Environment]::NewLine }
        Backup-ConfigFile $CodexConfigPath
        Write-CodexConfig $newText
        Write-Host '  Codex Desktop : mcp-search-net configuré dans config.toml' -ForegroundColor Green
    }
    if (-not $integrations.ContainsKey($integKeyCodex)) {
        $integrations[$integKeyCodex] = [PSCustomObject]@{
            ownership    = 'managed'
            configPath   = $CodexConfigPath
            configuredAt = [datetime]::UtcNow.ToString('o')
        }
    }
}

# ── Persist integrations ───────────────────────────────────────────────────────

Save-Integrations $integrations

if ($Uninstall) {
    Write-Host ''
    Write-Host 'Nettoyage MCP clients terminé.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host "Configuration post-installation terminée : $InstallRoot" -ForegroundColor Green
    Write-Host "  Exemple MCP Copilot  : $(Join-Path $InstallRoot 'mcp.json.example')"
    Write-Host "  Intégrations clients : $IntegrationsFile"
}
