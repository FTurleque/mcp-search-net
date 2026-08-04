param([string] $Out)

$ErrorActionPreference = 'Continue'

function Test-DockerPresent {
    $c = Get-Command docker -ErrorAction SilentlyContinue
    if ($c) { return $true }
    foreach ($p in @(
        (Join-Path $env:PROGRAMFILES 'Docker\Docker\resources\bin\docker.exe'),
        (Join-Path $env:LOCALAPPDATA 'Docker\resources\bin\docker.exe'),
        (Join-Path $env:PROGRAMFILES 'Docker\Docker\Docker Desktop.exe')
    )) {
        if (Test-Path -LiteralPath $p -PathType Leaf) { return $true }
    }
    return $false
}

function Resolve-RealCommand([string] $Name) {
    $c = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $c) { return $null }
    if ($c.CommandType -in @('Application', 'ExternalScript')) { return $c.Source }
    return $null
}

function Test-VsCodeShim([string] $Path) {
    $l = $Path.ToLowerInvariant()
    return ($l -like '*microsoft vs code*') -or ($l -like '*code\bin*') -or ($l -like '*vscode*\bin*')
}

function Test-CommandCapability([string] $Path, [string[]] $CmdArgs) {
    try {
        & $Path @CmdArgs 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

$lines = New-Object System.Collections.Generic.List[string]

# [Docker]
$dockerOk = Test-DockerPresent
$lines.Add('[Docker]')
if ($dockerOk) {
    $lines.Add('Available=1')
    $lines.Add('Reason=Docker detecte - SearXNG + Crawl4AI peuvent demarrer')
} else {
    $lines.Add('Available=0')
    $lines.Add('Reason=Docker non installe - requis pour SearXNG et Crawl4AI')
}

# [CopilotJetBrains]
$jbDir = Join-Path $env:LOCALAPPDATA 'github-copilot\intellij'
$jbOk  = Test-Path -LiteralPath $jbDir -PathType Container
$lines.Add('[CopilotJetBrains]')
if ($jbOk) {
    $lines.Add('Available=1')
    $lines.Add('Reason=Copilot JetBrains detecte')
} else {
    $lines.Add('Available=0')
    $lines.Add('Reason=Copilot JetBrains non installe')
}

# [CopilotCli]
$copilotPath = Resolve-RealCommand 'copilot'
$copilotOk   = $false
if ($copilotPath -and -not (Test-VsCodeShim $copilotPath)) {
    $copilotOk = Test-CommandCapability $copilotPath @('mcp', '--help')
}
$lines.Add('[CopilotCli]')
if ($copilotOk) {
    $lines.Add('Available=1')
    $lines.Add('Reason=GitHub Copilot CLI detecte (mcp --help OK)')
} else {
    $lines.Add('Available=0')
    $lines.Add('Reason=Copilot CLI non detecte ou sans support mcp')
}

# [ClaudeDesktop]
$desktopOk = $false
$pkgsDir = Join-Path $env:LOCALAPPDATA 'Packages'
if (Test-Path -LiteralPath $pkgsDir -PathType Container) {
    foreach ($pkg in (Get-ChildItem -LiteralPath $pkgsDir -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue)) {
        if (Test-Path -LiteralPath (Join-Path $pkg.FullName 'LocalCache\Roaming\Claude') -PathType Container) {
            $desktopOk = $true; break
        }
    }
}
if (-not $desktopOk) {
    $appDataClaude = Join-Path $env:APPDATA 'Claude'
    $claudeCodeDir = Join-Path $appDataClaude 'claude-code'
    if ((Test-Path -LiteralPath $appDataClaude -PathType Container) -and
        -not (Test-Path -LiteralPath $claudeCodeDir -PathType Container)) {
        $desktopOk = $true
    }
}
$lines.Add('[ClaudeDesktop]')
if ($desktopOk) {
    $lines.Add('Available=1')
    $lines.Add('Reason=Claude Desktop detecte')
} else {
    $lines.Add('Available=0')
    $lines.Add('Reason=Claude Desktop non installe')
}

# [ClaudeCode]
$codeOk = $null -ne (Get-Command claude -ErrorAction SilentlyContinue)
if (-not $codeOk) {
    $codeOk = Test-Path -LiteralPath (Join-Path $env:APPDATA 'Claude\claude-code') -PathType Container
}
$lines.Add('[ClaudeCode]')
if ($codeOk) {
    $lines.Add('Available=1')
    $lines.Add('Reason=Claude Code CLI detecte')
} else {
    $lines.Add('Available=0')
    $lines.Add('Reason=Claude Code non installe (claude absent du PATH)')
}

# [CodexDesktop]
$codexOk = Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.codex\config.toml') -PathType Leaf
if (-not $codexOk) {
    foreach ($p in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Codex\Codex.exe'),
        (Join-Path $env:LOCALAPPDATA 'Codex\Codex.exe')
    )) {
        if (Test-Path -LiteralPath $p -PathType Leaf) { $codexOk = $true; break }
    }
}
if (-not $codexOk) {
    $codexCmd = Resolve-RealCommand 'codex'
    if ($codexCmd) { $codexOk = $true }
}
$lines.Add('[CodexDesktop]')
if ($codexOk) {
    $lines.Add('Available=1')
    $lines.Add('Reason=Codex Desktop detecte')
} else {
    $lines.Add('Available=0')
    $lines.Add('Reason=Codex Desktop non installe')
}

[System.IO.File]::WriteAllLines($Out, [string[]]$lines.ToArray(), [System.Text.Encoding]::Unicode)
