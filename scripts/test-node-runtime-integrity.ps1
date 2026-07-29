[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Verifier = Join-Path $PSScriptRoot 'windows\verify-file-sha256.ps1'
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ("mcp-search-net-runtime-integrity-{0}" -f [guid]::NewGuid())

try {
    New-Item -ItemType Directory -Path $Root | Out-Null
    $Artifact = Join-Path $Root 'artifact.bin'
    [System.IO.File]::WriteAllText($Artifact, 'verified runtime artifact', (New-Object System.Text.UTF8Encoding($false)))
    $Expected = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash

    $Valid = & $Verifier -FilePath $Artifact -ExpectedSha256 $Expected | ConvertFrom-Json
    if (-not $Valid.verified -or $Valid.sha256 -cne $Expected.ToLowerInvariant()) {
        throw 'Le contrôle SHA-256 valide n’a pas produit la preuve attendue.'
    }

    $Rejected = $false
    try {
        & $Verifier -FilePath $Artifact -ExpectedSha256 ('0' * 64) | Out-Null
    }
    catch {
        $Rejected = $_.Exception.Message -match 'Intégrité SHA-256 invalide'
    }
    if (-not $Rejected) {
        throw 'Un checksum invalide n’a pas été refusé.'
    }

    Write-Host 'NODE_RUNTIME_INTEGRITY_VALID: valid checksum accepted; invalid checksum rejected.'
}
finally {
    if (Test-Path -LiteralPath $Root) {
        Remove-Item -LiteralPath $Root -Recurse -Force
    }
}
