[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Repository,
    [Parameter(Mandatory)] [ValidatePattern('^[a-fA-F0-9]{40}$')] [string] $CommitSha
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $Gh) { throw 'GitHub CLI (gh) est requis pour vérifier la certification native.' }
if ([string]::IsNullOrWhiteSpace([string]$env:GH_TOKEN)) {
    throw 'GH_TOKEN est requis pour vérifier la certification native.'
}

$CommitSha = $CommitSha.ToLowerInvariant()
$workflow = 'native-client-certification-record.yml'
$runs = gh api "repos/$Repository/actions/workflows/$workflow/runs?branch=master&event=workflow_dispatch&head_sha=$CommitSha&status=completed&per_page=50" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Impossible de récupérer les runs de certification native.' }

$candidates = @(
    $runs.workflow_runs |
        Where-Object {
            [string]$_.head_sha -eq $CommitSha -and
            [string]$_.head_branch -eq 'master' -and
            [string]$_.event -eq 'workflow_dispatch' -and
            [string]$_.conclusion -eq 'success'
        } |
        Sort-Object created_at -Descending
)

$expectedArtifact = "native-client-certification-$CommitSha"
foreach ($run in $candidates) {
    $artifacts = gh api "repos/$Repository/actions/runs/$($run.id)/artifacts?per_page=100" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { continue }
    $artifact = @(
        $artifacts.artifacts |
            Where-Object {
                [string]$_.name -eq $expectedArtifact -and
                -not [bool]$_.expired
            }
    ) | Select-Object -First 1
    if ($null -ne $artifact) {
        Write-Host "NATIVE_CLIENT_CERTIFICATION_EXACT_HEAD_QUALIFIED run=$($run.id) artifact=$($artifact.id) sha=$CommitSha"
        exit 0
    }
}

throw "Aucune certification native 3/3 réussie et non expirée n'est liée au SHA exact $CommitSha. Exécutez '$workflow' sur master après les trois observations natives."
