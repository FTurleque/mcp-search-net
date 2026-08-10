[CmdletBinding()]
param(
    [string] $InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [string] $OutputDirectory = '',
    [switch] $SmokeMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedTools = @('search_web', 'fetch_url', 'search_docs', 'list_docs', 'read_doc_section')
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

function Find-ClaudeDesktopConfig {
    try {
        $packages = Join-Path $env:LOCALAPPDATA 'Packages'
        if (Test-Path -LiteralPath $packages -PathType Container) {
            foreach ($pkg in Get-ChildItem -LiteralPath $packages -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue) {
                $candidate = Join-Path $pkg.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json'
                if (Test-Path -LiteralPath (Split-Path $candidate -Parent) -PathType Container) {
                    return $candidate
                }
            }
        }
    } catch {
        Write-Verbose "Claude Desktop package detection failed: $($_.Exception.Message)"
    }
    return (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json')
}

function Find-ClaudeDesktopVersion {
    try {
        $process = Get-Process -Name 'Claude' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($process -and $process.Path) {
            return [System.Diagnostics.FileVersionInfo]::GetVersionInfo($process.Path).ProductVersion
        }
    } catch {
        Write-Verbose "Claude Desktop process version detection failed: $($_.Exception.Message)"
    }
    try {
        $package = Get-AppxPackage -Name 'Claude*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
        if ($package) { return [string]$package.Version }
    } catch {
        Write-Verbose "Claude Desktop package version detection failed: $($_.Exception.Message)"
    }
    return $null
}

function Find-CodexVersion([string] $Executable) {
    $commandVersion = Get-VersionProbe $Executable
    if ($commandVersion) { return $commandVersion }

    try {
        $process = Get-Process -Name 'Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($process -and $process.Path) {
            $productVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($process.Path).ProductVersion
            if ($productVersion) { return $productVersion }
        }
    } catch {
        Write-Verbose "Codex process version detection failed: $($_.Exception.Message)"
    }

    try {
        $package = Get-AppxPackage -Name '*Codex*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
        if ($package) { return [string]$package.Version }
    } catch {
        Write-Verbose "Codex package version detection failed: $($_.Exception.Message)"
    }

    return $null
}

$buildManifestPath = Join-Path $InstallRoot 'BUILD-MANIFEST.json'
$buildManifest = Read-JsonSafe $buildManifestPath
$launcherPath = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$server = [PSCustomObject][ordered]@{
    installRoot = Normalize-PathForReport $InstallRoot
    installExists = Test-Path -LiteralPath $InstallRoot -PathType Container
    launcherExists = Test-Path -LiteralPath $launcherPath -PathType Leaf
    version = if ($buildManifest -and (Get-PropertyExists $buildManifest 'version')) { $buildManifest.version } else { $null }
    sourceRevision = if ($buildManifest -and (Get-PropertyExists $buildManifest 'sourceRevision')) { $buildManifest.sourceRevision } else { $null }
    sourceState = if ($buildManifest -and (Get-PropertyExists $buildManifest 'sourceState')) { $buildManifest.sourceState } else { $null }
}

$clients = @()

if ($SmokeMode) {
    $negative = 'No MCP server named "mcp-search-net". Configured servers: minos'
    if (Test-TextServerResponse -Text $negative -Name $ServerName) {
        throw 'Smoke regression: not-found text must never be accepted as server evidence.'
    }

    foreach ($name in $CertificationClients) {
        $clients += New-ClientResult -Name $name -Detected $false -Version $null -ConfigurationPath $null -Configured $false -ServerListed $false -ServerDetailsAvailable $false -ExpectedToolsSeen @() -EvidenceSource 'SMOKE_MODE' -NextAction 'Run without -SmokeMode on the Windows workstation.'
    }
} else {
    $claudeFallback = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    $claudeExe = Resolve-CommandPath -Name 'claude' -Fallbacks @($claudeFallback)
    $claudeList = $null
    $claudeGet = $null
    if ($claudeExe) {
        $claudeList = Invoke-ExternalCapture -Executable $claudeExe -Arguments @('mcp', 'list') -TimeoutSeconds 15
        $claudeGet = Invoke-ExternalCapture -Executable $claudeExe -Arguments @('mcp', 'get', $ServerName) -TimeoutSeconds 15
    }
    $claudeText = if ($claudeGet) { $claudeGet.stdout + $claudeGet.stderr } else { '' }
    $claudeListText = if ($claudeList) { $claudeList.stdout + $claudeList.stderr } else { '' }
    $claudeListValid = [bool]($claudeList -and $claudeList.completed -and $claudeList.exitCode -eq 0 -and (Test-TextServerResponse -Text $claudeListText -Name $ServerName))
    $claudeGetValid = [bool]($claudeGet -and $claudeGet.completed -and $claudeGet.exitCode -eq 0 -and (Test-TextServerResponse -Text $claudeText -Name $ServerName))
    $clients += New-ClientResult `
        -Name 'Claude Code' `
        -Detected ([bool]$claudeExe) `
        -Version (Get-VersionProbe $claudeExe) `
        -ConfigurationPath $null `
        -Configured ([bool]($claudeGetValid -or $claudeListValid)) `
        -ServerListed $claudeListValid `
        -ServerDetailsAvailable $claudeGetValid `
        -ExpectedToolsSeen (Get-ExpectedToolsSeen $claudeText) `
        -EvidenceSource 'claude mcp list/get' `
        -NextAction 'Run Claude Code and explicitly call mcp-search-net search_docs, then read_doc_section with the returned sectionId.'

    $claudeDesktopConfig = Find-ClaudeDesktopConfig
    $claudeDesktopConfigured = Test-JsonServerEntry -Path $claudeDesktopConfig -RootKeys @('mcpServers')
    $claudeProcess = Get-Process -Name 'Claude' -ErrorAction SilentlyContinue | Select-Object -First 1
    $claudeDesktopDetected = (Test-Path -LiteralPath (Split-Path $claudeDesktopConfig -Parent) -PathType Container) -or [bool]$claudeProcess
    $clients += New-ClientResult `
        -Name 'Claude Desktop' `
        -Detected $claudeDesktopDetected `
        -Version (Find-ClaudeDesktopVersion) `
        -ConfigurationPath (Normalize-PathForReport $claudeDesktopConfig) `
        -Configured $claudeDesktopConfigured `
        -ServerListed $claudeDesktopConfigured `
        -ServerDetailsAvailable $claudeDesktopConfigured `
        -ExpectedToolsSeen @() `
        -EvidenceSource 'claude_desktop_config.json + local process/package version' `
        -NextAction 'Restart Claude Desktop, then execute search_docs -> read_doc_section with the exact returned sectionId and record both native calls.'

    $codexExe = Resolve-CommandPath -Name 'codex'
    $codexConfig = Join-Path $env:USERPROFILE '.codex\config.toml'
    $codexText = if (Test-Path -LiteralPath $codexConfig -PathType Leaf) { Get-Content -LiteralPath $codexConfig -Raw -Encoding UTF8 } else { '' }
    $codexConfigured = $codexText -match '(?m)^\s*\[mcp_servers\.mcp-search-net\]\s*(?:#.*)?$'
    $codexList = $null
    if ($codexExe) {
        $codexList = Invoke-ExternalCapture -Executable $codexExe -Arguments @('mcp', 'list') -TimeoutSeconds 15
    }
    $codexListText = if ($codexList) { $codexList.stdout + $codexList.stderr } else { '' }
    $codexProcess = Get-Process -Name 'Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
    $codexDetected = [bool]$codexExe -or [bool]$codexProcess -or (Test-Path -LiteralPath (Split-Path $codexConfig -Parent) -PathType Container)
    $clients += New-ClientResult `
        -Name 'Codex' `
        -Detected $codexDetected `
        -Version (Find-CodexVersion $codexExe) `
        -ConfigurationPath (Normalize-PathForReport $codexConfig) `
        -Configured ([bool]($codexConfigured -or ($codexList -and $codexList.completed -and $codexList.exitCode -eq 0 -and $codexListText -match [regex]::Escape($ServerName)))) `
        -ServerListed ([bool]($codexList -and $codexList.completed -and $codexList.exitCode -eq 0 -and $codexListText -match [regex]::Escape($ServerName))) `
        -ServerDetailsAvailable $codexConfigured `
        -ExpectedToolsSeen (Get-ExpectedToolsSeen $codexListText) `
        -EvidenceSource 'codex mcp list + ~/.codex/config.toml + process/MSIX version fallback' `
        -NextAction 'Start a fresh Codex session and execute mcp-search-net search_docs -> read_doc_section with the exact returned sectionId; record both native calls.'
}

$report = [PSCustomObject][ordered]@{
    schemaVersion = '1.0'
    generatedAt = [datetime]::UtcNow.ToString('o')
    smokeMode = [bool]$SmokeMode
    host = [PSCustomObject][ordered]@{
        osVersion = [Environment]::OSVersion.VersionString
        osArchitecture = Get-OperatingSystemArchitecture
        powershellVersion = $PSVersionTable.PSVersion.ToString()
    }
    server = $server
    expectedTools = $ExpectedTools
    certificationScope = $CertificationClients
    excludedCertificationClients = $ExcludedCertificationClients
    clients = @($clients)
    closureRule = 'Issue #34 certification scope is Claude Code, Claude Desktop, and Codex; a future requalification requires nativeToolInvocationObserved=true evidence for all three clients.'
}

$jsonPath = Join-Path $OutputDirectory 'native-client-certification.json'
$markdownPath = Join-Path $OutputDirectory 'native-client-certification.md'
[System.IO.File]::WriteAllText($jsonPath, ($report | ConvertTo-Json -Depth 12) + "`r`n", $Utf8NoBom)

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# Native MCP client certification evidence')
$lines.Add('')
$lines.Add("Generated UTC: $($report.generatedAt)")
$lines.Add("Server revision: $($server.sourceRevision)")
$lines.Add("Server version: $($server.version)")
$lines.Add('Certification scope: Claude Code, Claude Desktop, Codex')
$lines.Add('Copilot integrations: supported for compatibility, excluded from certification scope')
$lines.Add('')
$lines.Add('| Client | Detected | Configured/listed | Tools seen by metadata | Native tool call | Verdict |')
$lines.Add('| --- | --- | --- | --- | --- | --- |')
foreach ($client in @($clients)) {
    $toolsSeen = @($client.expectedToolsSeen | Where-Object { $null -ne $_ -and $_ -ne '' })
    $tools = if ((Get-CollectionCount $toolsSeen) -gt 0) { $toolsSeen -join ', ' } else { '-' }
    $lines.Add("| $($client.name) | $($client.detected) | $($client.configured -or $client.serverListed) | $tools | false | NON OBSERVE |")
}
$lines.Add('')
$lines.Add('## Manual completion for a future requalification')
$lines.Add('')
$lines.Add('For each retained client, perform a real native tool invocation and record the client version, OS, server revision, and observed tool call. The required workflow is `search_docs -> exact returned sectionId -> read_doc_section(same sectionId)`.')
$lines.Add('')
foreach ($client in @($clients)) {
    $lines.Add("- **$($client.name)**: $($client.nextAction)")
}
[System.IO.File]::WriteAllText($markdownPath, ($lines -join "`r`n") + "`r`n", $Utf8NoBom)

if ($SmokeMode) {
    $clientCount = Get-CollectionCount $clients
    if ($clientCount -ne 3) { throw "Smoke mode expected three client records, got $clientCount." }
    $parsed = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not (Get-PropertyExists $parsed 'clients')) { throw 'Smoke mode report is missing clients.' }
    $parsedClientCount = Get-CollectionCount $parsed.clients
    if ($parsed.schemaVersion -ne '1.0' -or $parsedClientCount -ne 3) {
        throw "Smoke mode report serialization is invalid (clients=$parsedClientCount)."
    }
    foreach ($name in $CertificationClients) {
        if (@($parsed.clients | Where-Object { $_.name -eq $name }).Count -ne 1) {
            throw "Smoke mode report is missing retained client '$name'."
        }
    }
    if (-not $parsed.host.osArchitecture) { throw 'Smoke mode report is missing OS architecture.' }
    Write-Host "NATIVE_CLIENT_CERTIFICATION_SMOKE_VALID json=$jsonPath markdown=$markdownPath"
} else {
    Write-Host "NATIVE_CLIENT_CERTIFICATION_COLLECTED json=$jsonPath markdown=$markdownPath"
    Write-Host 'No native PASS is inferred from configuration/listing alone. For any future requalification, record real search_docs -> read_doc_section calls for Claude Code, Claude Desktop, and Codex.'
}
