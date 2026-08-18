[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'mcp-search-net'),
    [switch]$StartServices,
    [switch]$RunAfterInstall,
    [switch]$SkipChecks,
    [switch]$ForceStopExistingProcess,
    [switch]$AllowCustomInstallRoot,
    [switch]$TestFailActivation,
    [ValidateRange(0, 1000)]
    [int]$TestFailActivationAfterEntries = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA est introuvable. Ce programme necessite un profil utilisateur Windows.'
}
if ($env:OS -ne 'Windows_NT') {
    throw 'Ce programme necessite Windows x64.'
}
if ($TestFailActivation -and $TestFailActivationAfterEntries -gt 0) {
    throw 'TestFailActivation et TestFailActivationAfterEntries sont mutuellement exclusifs.'
}

$NodeVersion = '24.18.0'
$NodeFolderName = "node-v$NodeVersion-win-x64"
$NodeArchiveName = "$NodeFolderName.zip"
$NodeDownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchiveName"
$NodeArchiveSha256 = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
$RepositoryRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot '..')).Path)
$DefaultInstallRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'mcp-search-net'))
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$ManagedApplicationName = 'mcp-search-net'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Test-SamePath {
    param(
        [Parameter(Mandatory)] [string]$Left,
        [Parameter(Mandatory)] [string]$Right
    )
    $trimChars = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd($trimChars)
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd($trimChars)
    return $leftFull.Equals($rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-OwnershipMarker {
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return $false }
    $markerPath = Join-Path $InstallRoot '.mcp-search-net-installation.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $false }
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.schemaVersion -ne '1.0' -or [string]$marker.name -ne $ManagedApplicationName) {
            return $false
        }
        $null = [guid]::Parse([string]$marker.installationId)
        return $true
    }
    catch {
        return $false
    }
}

function Test-LegacyOwnedInstallation {
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return $false }
    $manifestPath = Join-Path $InstallRoot 'BUILD-MANIFEST.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ([string]$manifest.name -ne $ManagedApplicationName) { return $false }
    }
    catch {
        return $false
    }
    return (
        (Test-Path -LiteralPath (Join-Path $InstallRoot 'app\build\bootstrap\main.js') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $InstallRoot 'bin\mcp-search-net.cmd') -PathType Leaf)
    )
}

function Assert-InstallRootPreflight {
    if (-not (Test-SamePath -Left $InstallRoot -Right $DefaultInstallRoot) -and -not $AllowCustomInstallRoot) {
        throw "MCP_INSTALL_CUSTOM_ROOT_REQUIRES_OPT_IN: utilisez -AllowCustomInstallRoot pour '$InstallRoot'."
    }

    $forbiddenRoots = @(
        [System.IO.Path]::GetPathRoot($InstallRoot),
        $env:USERPROFILE,
        $env:LOCALAPPDATA,
        $env:APPDATA,
        $env:ProgramData,
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:SystemRoot,
        $env:TEMP,
        [System.IO.Path]::GetTempPath()
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
    foreach ($forbiddenRoot in $forbiddenRoots) {
        if (Test-SamePath -Left $InstallRoot -Right ([string]$forbiddenRoot)) {
            throw "MCP_INSTALL_UNSAFE_INSTALL_ROOT: racine systeme ou utilisateur interdite : $InstallRoot"
        }
    }

    if (-not (Test-Path -LiteralPath $InstallRoot)) { return }
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
        throw "MCP_INSTALL_UNSAFE_INSTALL_ROOT: le chemin existe mais n'est pas un dossier : $InstallRoot"
    }
    $rootItem = Get-Item -LiteralPath $InstallRoot -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "MCP_INSTALL_UNSAFE_INSTALL_ROOT: une racine d'installation de type reparse point est refusee : $InstallRoot"
    }
    $children = @(Get-ChildItem -LiteralPath $InstallRoot -Force)
    if ($children.Count -eq 0) { return }
    if (Test-OwnershipMarker) { return }
    if (Test-LegacyOwnedInstallation) { return }
    throw "MCP_INSTALL_UNSAFE_INSTALL_ROOT: dossier non vide sans preuve d'ownership mcp-search-net : $InstallRoot"
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(ValueFromRemainingArguments)] [string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "La commande '$FilePath' a echoue avec le code $LASTEXITCODE."
    }
}

function Get-SourceRevision {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($null -ne $git -and (Test-Path -LiteralPath (Join-Path $RepositoryRoot '.git'))) {
        $candidate = ((& $git.Source -C $RepositoryRoot rev-parse --verify HEAD 2>$null) | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $candidate -match '^[a-fA-F0-9]{40}$') {
            return $candidate.ToLowerInvariant()
        }
    }
    if ($env:GITHUB_SHA -match '^[a-fA-F0-9]{40}$') {
        return $env:GITHUB_SHA.ToLowerInvariant()
    }
    return 'UNAVAILABLE'
}

function Get-InstalledMcpProcesses {
    if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { return @() }
    $needles = @(
        (Join-Path $InstallRoot 'bin\mcp-search-net.cmd'),
        (Join-Path $InstallRoot 'app\build\bootstrap\main.js')
    )
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        if ($null -eq $_.CommandLine -or [int]$_.ProcessId -eq [int]$PID) { return $false }
        foreach ($needle in $needles) {
            if ($_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
        return $false
    })
}

function Assert-ProcessPolicy {
    if ($ForceStopExistingProcess) { return }
    $processes = @(Get-InstalledMcpProcesses)
    if ($processes.Count -eq 0) { return }
    foreach ($process in $processes) {
        Write-Host "PID: $($process.ProcessId) - $($process.Name)"
        Write-Host "CommandLine: $($process.CommandLine)"
    }
    throw "MCP_INSTALL_PROCESS_LOCK: $($processes.Count) processus mcp-search-net actif(s). Fermez-les ou utilisez -ForceStopExistingProcess."
}

function Get-VerifiedNodeArchive {
    $cacheRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'mcp-search-net-download-cache'
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    $archivePath = Join-Path $cacheRoot $NodeArchiveName
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $NodeArchiveSha256) {
            Remove-Item -LiteralPath $archivePath -Force
        }
    }
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        $temporaryArchive = Join-Path $cacheRoot ('.' + $NodeArchiveName + '.tmp-' + [guid]::NewGuid().ToString('N'))
        try {
            Write-Host "Telechargement de Node.js $NodeVersion LTS depuis nodejs.org..."
            Invoke-WebRequest -Uri $NodeDownloadUrl -OutFile $temporaryArchive -UseBasicParsing
            $hash = (Get-FileHash -LiteralPath $temporaryArchive -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne $NodeArchiveSha256) {
                throw "SHA-256 Node.js invalide : attendu=$NodeArchiveSha256 obtenu=$hash"
            }
            Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
        }
        finally {
            if (Test-Path -LiteralPath $temporaryArchive -PathType Leaf) {
                Remove-Item -LiteralPath $temporaryArchive -Force -ErrorAction SilentlyContinue
            }
        }
    }
    return $archivePath
}

Assert-InstallRootPreflight
Assert-ProcessPolicy

$Package = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Raw | ConvertFrom-Json
$SourceRevision = Get-SourceRevision
$NodeArchivePath = Get-VerifiedNodeArchive
$TemporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('mcp-search-net-source-install-' + [guid]::NewGuid().ToString('N'))
$BootstrapRuntimeRoot = Join-Path $TemporaryRoot 'bootstrap-runtime'
$DistributionOutputRoot = Join-Path $TemporaryRoot 'dist'

try {
    New-Item -ItemType Directory -Force -Path $BootstrapRuntimeRoot, $DistributionOutputRoot | Out-Null
    Expand-Archive -LiteralPath $NodeArchivePath -DestinationPath $BootstrapRuntimeRoot -Force
    $BootstrapNodeRoot = Join-Path $BootstrapRuntimeRoot $NodeFolderName
    $BootstrapNodeExe = Join-Path $BootstrapNodeRoot 'node.exe'
    $BootstrapNpmCmd = Join-Path $BootstrapNodeRoot 'npm.cmd'
    if (-not (Test-Path -LiteralPath $BootstrapNodeExe -PathType Leaf) -or
        -not (Test-Path -LiteralPath $BootstrapNpmCmd -PathType Leaf)) {
        throw 'Runtime Node.js bootstrap incomplet.'
    }

    $NodeSignature = Get-AuthenticodeSignature -LiteralPath $BootstrapNodeExe
    if ($NodeSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $NodeSignature.SignerCertificate -or
        $NodeSignature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') {
        throw "Signature Authenticode Node.js invalide ou signataire inattendu : $($NodeSignature.Status)."
    }
    $InstalledNodeVersion = (& $BootstrapNodeExe '--version').TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or $InstalledNodeVersion -ne $NodeVersion) {
        throw "Version Node.js bootstrap invalide : attendu $NodeVersion, obtenu $InstalledNodeVersion."
    }

    $PreviousPath = $env:PATH
    $env:PATH = "$BootstrapNodeRoot;$PreviousPath"
    try {
        if (-not $SkipChecks) {
            Push-Location $RepositoryRoot
            try {
                Write-Host 'Validation complete du projet avant construction de la distribution...'
                Invoke-NativeCommand $BootstrapNpmCmd 'ci'
                Invoke-NativeCommand $BootstrapNpmCmd 'run' 'check'
            }
            finally {
                Pop-Location
            }
        }

        $DistributionBuilder = Join-Path $RepositoryRoot 'scripts\release\build-windows-distribution.ps1'
        & $DistributionBuilder `
            -Version ([string]$Package.version) `
            -NodeZipPath $NodeArchivePath `
            -CommitSha $SourceRevision `
            -OutputRoot $DistributionOutputRoot
        if ($LASTEXITCODE -ne 0) {
            throw "build-windows-distribution.ps1 a echoue (code $LASTEXITCODE)."
        }
    }
    finally {
        $env:PATH = $PreviousPath
    }

    $DistributionRoot = Join-Path $DistributionOutputRoot ("mcp-search-net-$($Package.version)-windows-x64")
    if (-not (Test-Path -LiteralPath $DistributionRoot -PathType Container)) {
        throw "Distribution Windows absente : $DistributionRoot"
    }

    $PackagedNodeExe = Join-Path $DistributionRoot "runtime\$NodeFolderName\node.exe"
    $NodeExeSha256 = (Get-FileHash -LiteralPath $PackagedNodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $RuntimeProof = [ordered]@{
        schemaVersion = '1.0'
        nodeVersion = $NodeVersion
        archiveName = $NodeArchiveName
        downloadUrl = $NodeDownloadUrl
        archiveSha256 = $NodeArchiveSha256
        archiveVerifiedAtInstall = $true
        nodeExeSha256 = $NodeExeSha256
        signatureStatus = [string]$NodeSignature.Status
        signerSubject = $NodeSignature.SignerCertificate.Subject
        verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $DistributionRoot 'runtime\node-runtime-proof.json'),
        (($RuntimeProof | ConvertTo-Json -Depth 4) + "`r`n"),
        $Utf8NoBom
    )

    $Updater = Join-Path $RepositoryRoot 'packaging\windows\update-installation.ps1'
    $WindowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $WindowsPowerShell -PathType Leaf)) {
        throw "Windows PowerShell 5.1 introuvable : $WindowsPowerShell"
    }
    $failureAfterEntries = if ($TestFailActivation) { 1 } else { $TestFailActivationAfterEntries }
    $UpdateCliArguments = @(
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $Updater,
        '-PackageRoot', $DistributionRoot,
        '-InstallRoot', $InstallRoot
    )
    if (-not $ForceStopExistingProcess) {
        $UpdateCliArguments += '-SkipProcessStop'
    }
    if ($failureAfterEntries -gt 0) {
        $UpdateCliArguments += @('-TestFailActivationAfterEntries', [string]$failureAfterEntries)
    }

    Write-Host "Activation transactionnelle de mcp-search-net dans $InstallRoot via Windows PowerShell 5.1..."
    Invoke-NativeCommand $WindowsPowerShell @UpdateCliArguments

    $ConfigureInstall = Join-Path $InstallRoot 'scripts\configure-install.ps1'
    & $ConfigureInstall -InstallRoot $InstallRoot -FromInstaller -Clients ''
    if ($LASTEXITCODE -ne 0) {
        throw "configure-install.ps1 a echoue (code $LASTEXITCODE)."
    }

    $ComposeProject = if ([string]::IsNullOrWhiteSpace($env:MCP_SEARCH_COMPOSE_PROJECT)) {
        'mcp-search-net'
    }
    else {
        $env:MCP_SEARCH_COMPOSE_PROJECT
    }
    $EnvironmentPath = Join-Path $InstallRoot '.env'
    if ($StartServices) {
        $Docker = Get-Command docker -ErrorAction SilentlyContinue
        if ($null -eq $Docker) {
            throw 'Docker est absent du PATH. Installez ou demarrez Docker Desktop, puis relancez avec -StartServices.'
        }
        Invoke-NativeCommand $Docker.Source `
            'compose' '--env-file' $EnvironmentPath '-p' $ComposeProject `
            '-f' (Join-Path $InstallRoot 'compose.yaml') `
            '-f' (Join-Path $InstallRoot 'compose.hybrid.yaml') `
            'up' '-d' '--wait' 'searxng' 'crawl4ai'
    }

    $Launcher = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
    Write-Host "Installation terminee. Lanceur MCP : $Launcher"
    Write-Host "Exemple Copilot : $(Join-Path $InstallRoot 'mcp.json.example')"

    if ($RunAfterInstall) {
        Write-Host 'Demarrage du serveur MCP STDIO (arreter avec Ctrl+C)...'
        & $Launcher
        exit $LASTEXITCODE
    }
}
finally {
    if (Test-Path -LiteralPath $TemporaryRoot -PathType Container) {
        Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}