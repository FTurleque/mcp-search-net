# cleanup-mcp-search-net.ps1
# Supprime les entrees mcp-search-net de tous les fichiers de configuration MCP
# et reformate le JSON en 2 espaces standard (via Node.js si dispo).
#
# Usage : powershell -NoProfile -ExecutionPolicy Bypass -File cleanup-mcp-search-net.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ServerKey = 'mcp-search-net'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Cherche node.exe : installation actuelle, installation legacy, ou PATH
function Find-NodeExe {
    foreach ($p in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\mcp-search-net\runtime\node-v24.18.0-win-x64\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'mcp-search-net\runtime\node-v24.18.0-win-x64\node.exe')
    )) {
        if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Write-Json2Spaces {
    param([string] $FilePath, [object] $Data, [string] $NodeExe)

    if ($NodeExe -and (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
        $tmp = $null
        try {
            $tmp = [System.IO.Path]::GetTempFileName()
            $compressed = $Data | ConvertTo-Json -Depth 10 -Compress
            [System.IO.File]::WriteAllText($tmp, $compressed, $Utf8NoBom)

            $psi                        = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName               = $NodeExe
            $psi.Arguments              = "-e `"const d=require('fs').readFileSync(process.argv[2],'utf8');process.stdout.write(JSON.stringify(JSON.parse(d),null,2))`" `"$tmp`""
            $psi.UseShellExecute        = $false
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError  = $true
            $psi.CreateNoWindow         = $true

            $proc     = [System.Diagnostics.Process]::Start($psi)
            $so       = $proc.StandardOutput.ReadToEndAsync()
            $se       = $proc.StandardError.ReadToEndAsync()
            $finished = $proc.WaitForExit(10000)
            [System.Threading.Tasks.Task]::WhenAll($so, $se).Wait(2000) | Out-Null
            $stdout   = if ($so.IsCompleted) { $so.Result } else { '' }
            $exitCode = if ($finished) { try { $proc.ExitCode } catch { -1 } } else { -1 }
            $proc.Dispose()

            if ($finished -and $exitCode -eq 0 -and $stdout) {
                [System.IO.File]::WriteAllText($FilePath, ($stdout + "`r`n"), $Utf8NoBom)
                return 'node'
            }
        } finally {
            if ($tmp -and (Test-Path -LiteralPath $tmp -PathType Leaf)) {
                Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # Fallback PS5.1
    $raw  = $Data | ConvertTo-Json -Depth 10
    $json = [regex]::Replace($raw, '":\s{2,}', '": ')
    [System.IO.File]::WriteAllText($FilePath, ($json + "`r`n"), $Utf8NoBom)
    return 'ps51'
}

function Remove-McpEntry {
    param([string] $FilePath, [string] $ClientName, [string] $NodeExe)

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        Write-Host "  $ClientName : fichier absent." -ForegroundColor DarkGray
        return
    }

    try {
        $raw  = [System.IO.File]::ReadAllText($FilePath, [System.Text.Encoding]::UTF8)
        $data = $raw | ConvertFrom-Json

        $found = $false
        foreach ($rk in @('mcpServers', 'servers')) {
            $rootProp = $data.PSObject.Properties | Where-Object { $_.Name -eq $rk }
            if ($rootProp) {
                $entProp = $rootProp.Value.PSObject.Properties | Where-Object { $_.Name -eq $ServerKey }
                if ($entProp) {
                    $rootProp.Value.PSObject.Properties.Remove($ServerKey)
                    $found = $true
                    break
                }
            }
        }

        if ($found) {
            # Backup
            $stamp   = [datetime]::UtcNow.ToString('yyyyMMddHHmmss')
            $bakDir  = Join-Path $env:TEMP 'mcp-search-net-cleanup-backups'
            New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
            [System.IO.File]::WriteAllText(
                (Join-Path $bakDir "$stamp-$(Split-Path $FilePath -Leaf)"), $raw, $Utf8NoBom)

            $method = Write-Json2Spaces $FilePath $data $NodeExe
            $tag = if ($method -eq 'node') { '(2 espaces, Node.js)' } else { '(PS5.1)' }
            Write-Host "  $ClientName : '$ServerKey' supprime $tag" -ForegroundColor Green
        } else {
            Write-Host "  $ClientName : entree '$ServerKey' absente." -ForegroundColor Cyan
        }
    } catch {
        Write-Host "  $ClientName : ERREUR - $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ---------------------------------------------------------------------------

$node = Find-NodeExe
Write-Host "Node.js : $(if ($node) { $node } else { 'non trouve (fallback PS5.1)' })"
Write-Host ''

# GitHub Copilot JetBrains
Remove-McpEntry (Join-Path $env:LOCALAPPDATA 'github-copilot\intellij\mcp.json') `
               'Copilot JetBrains' $node

# GitHub Copilot VS Code
Remove-McpEntry (Join-Path $env:APPDATA 'Code\User\globalStorage\github.copilot-chat\mcp.json') `
               'Copilot VS Code' $node

# Claude Desktop (MSIX)
$pkgsDir = Join-Path $env:LOCALAPPDATA 'Packages'
if (Test-Path -LiteralPath $pkgsDir -PathType Container) {
    Get-ChildItem -LiteralPath $pkgsDir -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            $f = Join-Path $_.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'
            if (Test-Path -LiteralPath (Split-Path $f -Parent) -PathType Container) {
                Remove-McpEntry $f 'Claude Desktop' $node
            }
        }
}

# Claude Desktop (AppData)
Remove-McpEntry (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json') `
               'Claude Desktop (AppData)' $node

Write-Host ''
Write-Host 'Nettoyage termine. Backups dans : ' -NoNewline
Write-Host (Join-Path $env:TEMP 'mcp-search-net-cleanup-backups') -ForegroundColor Cyan
Write-Host 'Redemarrez vos clients IA pour appliquer les changements.' -ForegroundColor Yellow
