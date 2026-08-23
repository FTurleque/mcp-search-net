[CmdletBinding()]
param(
    [string] $InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [string] $OutputDirectory = '',
    [switch] $SmokeMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedTools = @('search_web', 'fetch_url', 'search_docs', 'list_docs', 'read_doc_section', 'list_search_history')
$CertificationClients = @('Claude Code', 'Claude Desktop', 'Codex')
$ExcludedCertificationClients = @('IntelliJ IDEA + GitHub Copilot', 'GitHub Copilot CLI')
$ServerName = 'mcp-search-net'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not $OutputDirectory) {
    $stamp = [datetime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    $OutputDirectory = Join-Path (Get-Location) ".data\native-client-certification-$stamp"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Get-PropertyExists([object] $Object, [string] $Name) {
    if ($null -eq $Object) { return $false }
    return $null -ne ($Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1)
}

function Get-CollectionCount([object] $Value) {
    return @($Value).Count
}

function Get-OperatingSystemArchitecture {
    $candidate = $env:PROCESSOR_ARCHITEW6432
    if (-not $candidate) { $candidate = $env:PROCESSOR_ARCHITECTURE }

    if ($candidate) {
        switch ($candidate.ToUpperInvariant()) {
            'AMD64' { return 'X64' }
            'ARM64' { return 'ARM64' }
            'X86' { return 'X86' }
            default { return $candidate.ToUpperInvariant() }
        }
    }

    if ([Environment]::Is64BitOperatingSystem) { return 'X64' }
    return 'X86'
}

function Read-JsonSafe([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        Write-Verbose "Unable to parse JSON '$Path': $($_.Exception.Message)"
        return $null
    }
}

function Test-TextServerResponse([string] $Text, [string] $Name) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    if ($Text -match '(?i)not\s+found|no\s+MCP\s+server\s+named') { return $false }
    return $Text -match [regex]::Escape($Name)
}

function Normalize-PathForReport([string] $Path) {
    if (-not $Path) { return $null }
    $value = [System.IO.Path]::GetFullPath($Path)
    $replacements = @(
        @($env:LOCALAPPDATA, '%LOCALAPPDATA%'),
        @($env:APPDATA, '%APPDATA%'),
        @($env:USERPROFILE, '%USERPROFILE%')
    )
    foreach ($replacement in $replacements) {
        $prefix = $replacement[0]
        if ($prefix -and $value.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $replacement[1] + $value.Substring($prefix.Length)
        }
    }
    return $value
}

function Quote-ProcessArgument([string] $Value) {
    if ($null -eq $Value) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-ExternalCapture {
    param(
        [Parameter(Mandatory)] [string] $Executable,
        [string[]] $Arguments = @(),
        [int] $TimeoutSeconds = 12
    )

    $extension = [System.IO.Path]::GetExtension($Executable)
    $realExecutable = $Executable
    $realArguments = $Arguments

    if ($extension -ieq '.ps1') {
        $realExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $realArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Executable) + $Arguments
    } elseif ($extension -ieq '.cmd' -or $extension -ieq '.bat') {
        $realExecutable = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $commandLine = ('"' + $Executable + '" ' + (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')).Trim()
        $realArguments = @('/d', '/s', '/c', $commandLine)
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $realExecutable
    $psi.Arguments = ($realArguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    try {
        $process = [System.Diagnostics.Process]::Start($psi)
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $finished = $process.WaitForExit($TimeoutSeconds * 1000)
        if (-not $finished) {
            try {
                $process.Kill()
            } catch {
                Write-Verbose "Unable to terminate timed-out process '$Executable': $($_.Exception.Message)"
            }
        }
        [System.Threading.Tasks.Task]::WhenAll($stdoutTask, $stderrTask).Wait(3000) | Out-Null
        $stdout = if ($stdoutTask.IsCompleted) { $stdoutTask.Result } else { '' }
        $stderr = if ($stderrTask.IsCompleted) { $stderrTask.Result } else { '' }
        $exitCode = if ($finished) {
            try { $process.ExitCode } catch { -1 }
        } else {
            -1
        }
        $process.Dispose()
        return [PSCustomObject]@{
            completed = $finished
            exitCode = $exitCode
            stdout = $stdout
            stderr = $stderr
        }
    } catch {
        return [PSCustomObject]@{
            completed = $false
            exitCode = -1
            stdout = ''
            stderr = $_.Exception.Message
        }
    }
}

function Resolve-CommandPath([string] $Name, [string[]] $Fallbacks = @()) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and (Get-PropertyExists $command 'Source') -and $command.Source) {
        return $command.Source
    }
    foreach ($fallback in @($Fallbacks)) {
        if ($fallback -and (Test-Path -LiteralPath $fallback -PathType Leaf)) { return $fallback }
    }
    return $null
}

function Get-VersionProbe([string] $Executable) {
    if (-not $Executable) { return $null }
    $probe = Invoke-ExternalCapture -Executable $Executable -Arguments @('--version') -TimeoutSeconds 8
    if (-not $probe.completed -or $probe.exitCode -ne 0) { return $null }
    $value = $probe.stdout.Trim()
    if (-not $value) { $value = $probe.stderr.Trim() }
    if ($value.Length -gt 300) { $value = $value.Substring(0, 300) }
    return $value
}

function Get-ExpectedToolsSeen([string] $Text) {
    $seen = @()
    foreach ($tool in $ExpectedTools) {
        if ($Text -match [regex]::Escape($tool)) { $seen += $tool }
    }
    Write-Output -NoEnumerate $seen
}

function Test-JsonServerEntry([string] $Path, [string[]] $RootKeys) {
    $data = Read-JsonSafe $Path
    if ($null -eq $data) { return $false }
    foreach ($rootKey in @($RootKeys)) {
        if ((Get-PropertyExists $data $rootKey) -and (Get-PropertyExists $data.$rootKey $ServerName)) {
            return $true
        }
    }
    return $false
}

function New-ClientResult {
    param(
        [string] $Name,
        [bool] $Detected,
        [string] $Version,
        [string] $ConfigurationPath,
        [bool] $Configured,
        [bool] $ServerListed,
        [bool] $ServerDetailsAvailable,
        [string[]] $ExpectedToolsSeen,
        [string] $EvidenceSource,
        [string] $NextAction
    )
    $normalizedTools = @($ExpectedToolsSeen | Where-Object { $null -ne $_ -and $_ -ne '' })
    return [PSCustomObject][ordered]@{
        name = $Name
        detected = $Detected
        version = $Version
        configurationPath = $ConfigurationPath
        configured = $Configured
        serverListed = $ServerListed
        serverDetailsAvailable = $ServerDetailsAvailable
        expectedToolsSeen = $normalizedTools
        evidenceSource = $EvidenceSource
        nativeToolInvocationObserved = $false
        verdict = 'NON_OBSERVE'
        nextAction = $NextAction
    }
}

function Resolve-CertificationWindowsProfilePath {
    $profile = $env:USERPROFILE
    if (-not $profile -or -not (Test-Path -LiteralPath $profile -PathType Container)) { return $null }
    return [System.IO.Path]::GetFullPath($profile)
}

function Get-ClaudeCodeResult {
    $exe = Resolve-CommandPath -Name 'claude' -Fallbacks @(
        (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
        (Join-Path $env:APPDATA 'npm\claude.cmd')
    )
    $version = Get-VersionProbe $exe
    $configPath = Join-Path $env:USERPROFILE '.claude.json'
    $configured = Test-JsonServerEntry -Path $configPath -RootKeys @('mcpServers')
    $listed = $false
    $details = $false
    $toolsSeen = @()
    $source = 'non observe'
    if ($exe) {
        $list = Invoke-ExternalCapture -Executable $exe -Arguments @('mcp', 'list') -TimeoutSeconds 15
        if ($list.completed -and $list.exitCode -eq 0) {
            $listed = Test-TextServerResponse -Text ($list.stdout + "`n" + $list.stderr) -Name $ServerName
            if ($listed) { $source = 'claude mcp list' }
        }
        if ($listed) {
            $get = Invoke-ExternalCapture -Executable $exe -Arguments @('mcp', 'get', $ServerName) -TimeoutSeconds 15
            if ($get.completed -and $get.exitCode -eq 0) {
                $text = $get.stdout + "`n" + $get.stderr
                $details = Test-TextServerResponse -Text $text -Name $ServerName
                $toolsSeen = Get-ExpectedToolsSeen $text
                if ($details) { $source = 'claude mcp get' }
            }
        }
    }
    return New-ClientResult -Name 'Claude Code' -Detected ([bool]$exe) -Version $version -ConfigurationPath (Normalize-PathForReport $configPath) -Configured $configured -ServerListed $listed -ServerDetailsAvailable $details -ExpectedToolsSeen $toolsSeen -EvidenceSource $source -NextAction 'Lancer une vraie recherche documentaire puis capturer le détail du serveur.'
}

function Get-ClaudeDesktopResult {
    $desktopExeCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe'),
        (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\Claude.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Claude\Claude.exe')
    )
    $desktopExe = $desktopExeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    $configPath = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
    $configured = Test-JsonServerEntry -Path $configPath -RootKeys @('mcpServers')
    $version = if ($desktopExe) {
        try { (Get-Item -LiteralPath $desktopExe).VersionInfo.ProductVersion } catch { $null }
    } else { $null }
    return New-ClientResult -Name 'Claude Desktop' -Detected ([bool]$desktopExe) -Version $version -ConfigurationPath (Normalize-PathForReport $configPath) -Configured $configured -ServerListed $configured -ServerDetailsAvailable $false -ExpectedToolsSeen @() -EvidenceSource $(if ($configured) { 'claude_desktop_config.json' } else { 'non observe' }) -NextAction 'Ouvrir Claude Desktop, afficher les outils MCP puis exécuter search_docs.'
}

function Get-CodexResult {
    $exe = Resolve-CommandPath -Name 'codex' -Fallbacks @(
        (Join-Path $env:APPDATA 'npm\codex.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Programs\codex\codex.exe')
    )
    $version = Get-VersionProbe $exe
    $configPath = Join-Path $env:USERPROFILE '.codex\config.toml'
    $configured = $false
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $toml = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
        $configured = $toml -match '(?m)^\[mcp_servers\.mcp-search-net\]\s*$'
    }
    $listed = $false
    $details = $false
    $toolsSeen = @()
    $source = 'non observe'
    if ($exe) {
        $list = Invoke-ExternalCapture -Executable $exe -Arguments @('mcp', 'list') -TimeoutSeconds 15
        if ($list.completed -and $list.exitCode -eq 0) {
            $listed = Test-TextServerResponse -Text ($list.stdout + "`n" + $list.stderr) -Name $ServerName
            if ($listed) { $source = 'codex mcp list' }
        }
        if ($listed) {
            $get = Invoke-ExternalCapture -Executable $exe -Arguments @('mcp', 'get', $ServerName) -TimeoutSeconds 15
            if ($get.completed -and $get.exitCode -eq 0) {
                $text = $get.stdout + "`n" + $get.stderr
                $details = Test-TextServerResponse -Text $text -Name $ServerName
                $toolsSeen = Get-ExpectedToolsSeen $text
                if ($details) { $source = 'codex mcp get' }
            }
        }
    }
    return New-ClientResult -Name 'Codex' -Detected ([bool]$exe) -Version $version -ConfigurationPath (Normalize-PathForReport $configPath) -Configured $configured -ServerListed $listed -ServerDetailsAvailable $details -ExpectedToolsSeen $toolsSeen -EvidenceSource $source -NextAction 'Exécuter une vraie chaîne search_docs -> read_doc_section avec Codex et capturer la sortie.'
}

$results = @(
    (Get-ClaudeCodeResult),
    (Get-ClaudeDesktopResult),
    (Get-CodexResult)
)

if ($SmokeMode) {
    $detected = @($results | Where-Object { $_.detected }).Count
    $configured = @($results | Where-Object { $_.configured }).Count
    $summary = [PSCustomObject][ordered]@{
        schemaVersion = '1.0'
        mode = 'smoke'
        certificationScope = $CertificationClients
        excludedClients = $ExcludedCertificationClients
        detected = $detected
        configured = $configured
        reportPath = $null
    }
    Write-Output ($summary | ConvertTo-Json -Depth 6)
    exit 0
}

$buildManifest = Read-JsonSafe (Join-Path $InstallRoot 'BUILD-MANIFEST.json')
$profilePath = Resolve-CertificationWindowsProfilePath
$report = [PSCustomObject][ordered]@{
    schemaVersion = '1.0'
    generatedAt = [datetime]::UtcNow.ToString('o')
    serverName = $ServerName
    serverVersion = if (Get-PropertyExists $buildManifest 'version') { [string]$buildManifest.version } else { 'UNAVAILABLE' }
    sourceRevision = if (Get-PropertyExists $buildManifest 'sourceRevision') { [string]$buildManifest.sourceRevision } else { 'UNAVAILABLE' }
    sourceState = if (Get-PropertyExists $buildManifest 'sourceState') { [string]$buildManifest.sourceState } else { 'UNAVAILABLE' }
    nodeVersion = if (Get-PropertyExists $buildManifest 'nodeVersion') { [string]$buildManifest.nodeVersion } else { 'UNAVAILABLE' }
    installRoot = (Normalize-PathForReport $InstallRoot)
    certificationScope = $CertificationClients
    excludedClients = $ExcludedCertificationClients
    expectedTools = $ExpectedTools
    environment = [PSCustomObject][ordered]@{
        os = [Environment]::OSVersion.VersionString
        osArchitecture = Get-OperatingSystemArchitecture
        processArchitecture = $env:PROCESSOR_ARCHITECTURE
        profilePath = (Normalize-PathForReport $profilePath)
    }
    clients = $results
    summary = [PSCustomObject][ordered]@{
        certified = 0
        detected = @($results | Where-Object { $_.detected }).Count
        configured = @($results | Where-Object { $_.configured }).Count
        nativeInvocationObserved = 0
    }
}

$reportPath = Join-Path $OutputDirectory 'native-client-certification-report.json'
[System.IO.File]::WriteAllText($reportPath, (($report | ConvertTo-Json -Depth 8) + "`r`n"), $Utf8NoBom)
Write-Host "Rapport écrit : $reportPath"
Write-Output ($report | ConvertTo-Json -Depth 8)
