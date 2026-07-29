[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [string]$ExpectedSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') {
    throw 'Le SHA-256 attendu doit contenir exactement 64 caractères hexadécimaux.'
}

$resolvedPath = (Resolve-Path -LiteralPath $FilePath).Path
$actualSha256 = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = $ExpectedSha256.ToLowerInvariant()

if ($actualSha256 -cne $expected) {
    throw "RUNTIME_ARCHIVE_CHECKSUM_MISMATCH : intégrité SHA-256 invalide pour '$resolvedPath'. Attendu : $expected ; obtenu : $actualSha256."
}

[ordered]@{
    algorithm = 'SHA-256'
    path = $resolvedPath
    sha256 = $actualSha256
    verified = $true
} | ConvertTo-Json -Compress
