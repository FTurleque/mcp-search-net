[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $SetupPath,
    [Parameter(Mandatory)] [string] $CertificateBase64,
    [Parameter(Mandatory)] [string] $CertificatePassword,
    [string] $ExpectedCertificateThumbprint = '',
    [string] $TimestampUrl = 'https://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NormalizedThumbprint {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Value)
    return ($Value -replace '\s', '').ToUpperInvariant()
}

if ($env:OS -ne 'Windows_NT') { throw 'La signature Authenticode doit être effectuée sur Windows.' }
$SetupPath = [System.IO.Path]::GetFullPath($SetupPath)
if (-not (Test-Path -LiteralPath $SetupPath -PathType Leaf)) {
    throw "Setup Windows introuvable : $SetupPath"
}
if ([string]::IsNullOrWhiteSpace($CertificateBase64)) {
    throw 'WINDOWS_SIGNING_CERTIFICATE_BASE64 est requis pour publier une release.'
}
if ([string]::IsNullOrWhiteSpace($CertificatePassword)) {
    throw 'WINDOWS_SIGNING_CERTIFICATE_PASSWORD est requis pour publier une release.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedCertificateThumbprint)) {
    throw 'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT est requis pour publier une release.'
}
$expectedThumbprint = Get-NormalizedThumbprint -Value $ExpectedCertificateThumbprint

function Resolve-SignTool {
    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (-not (Test-Path -LiteralPath $kitsRoot -PathType Container)) {
        throw "Windows SDK bin directory introuvable : $kitsRoot"
    }
    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Directory -ErrorAction Stop |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace([string]$candidate)) {
        throw 'signtool.exe x64 introuvable dans le Windows SDK.'
    }
    return [System.IO.Path]::GetFullPath([string]$candidate)
}

$pfx = Join-Path $env:RUNNER_TEMP ("mcp-search-net-signing-" + [guid]::NewGuid().ToString('N') + '.pfx')
try {
    try { $bytes = [Convert]::FromBase64String($CertificateBase64) }
    catch { throw "Certificat Authenticode base64 invalide : $($_.Exception.Message)" }
    [System.IO.File]::WriteAllBytes($pfx, $bytes)

    $signtool = Resolve-SignTool
    & $signtool sign /fd SHA256 /td SHA256 /tr $TimestampUrl /f $pfx /p $CertificatePassword $SetupPath
    if ($LASTEXITCODE -ne 0) { throw "Signature Authenticode échouée (exit=$LASTEXITCODE)." }

    & $signtool verify /pa /all /v $SetupPath
    if ($LASTEXITCODE -ne 0) { throw "Vérification signtool échouée (exit=$LASTEXITCODE)." }

    $signature = Get-AuthenticodeSignature -FilePath $SetupPath
    if ([string]$signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
        throw "Signature Authenticode invalide : status=$($signature.Status)"
    }

    $actualThumbprint = Get-NormalizedThumbprint -Value $signature.SignerCertificate.Thumbprint
    if ($actualThumbprint -ne $expectedThumbprint) {
        throw "Empreinte du certificat Authenticode inattendue : attendu=$expectedThumbprint obtenu=$actualThumbprint"
    }

    $codeSigningEkuOid = '1.3.6.1.5.5.7.3.3'
    $hasCodeSigningEku = @($signature.SignerCertificate.EnhancedKeyUsageList) |
        Where-Object { $_.ObjectId -eq $codeSigningEkuOid } |
        Select-Object -First 1
    if ($null -eq $hasCodeSigningEku) {
        throw "Le certificat de signature ne possede pas l'EKU Code Signing ($codeSigningEkuOid)."
    }

    $checksum = "$SetupPath.sha256"
    $hash = (Get-FileHash -LiteralPath $SetupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([System.IO.Path]::GetFileName($SetupPath))" | Set-Content -LiteralPath $checksum -Encoding ascii
    Write-Host "WINDOWS_AUTHENTICODE_VALID subject=$($signature.SignerCertificate.Subject) sha256=$hash"
}
finally {
    if (Test-Path -LiteralPath $pfx -PathType Leaf) {
        Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
    }
}
