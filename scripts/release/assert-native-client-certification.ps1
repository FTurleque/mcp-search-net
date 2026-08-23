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
$expectedClients = @('Claude Code', 'Claude Desktop', 'Codex')

function Test-PropertyPresent($Object, [string] $Name) {
    return $null -ne $Object -and (@($Object.PSObject.Properties.Name) -contains $Name)
}

function Assert-RequiredField($Object, [string] $Name, [string] $Context) {
    if (-not (Test-PropertyPresent $Object $Name) -or [string]::IsNullOrWhiteSpace([string]$Object.$Name)) {
        throw "$Context is missing required field: $Name"
    }
}

function Assert-ValidNativeCertificationArtifact($Record, [string] $Repository, [string] $CommitSha) {
    # This is the sole gate for whether a downloaded artifact may certify a release. It must
    # never pass merely because the artifact exists and is named correctly (that was the AUD-01
    # gap): every field the record workflow is trusted to have validated is re-validated here,
    # independently, against the artifact's actual downloaded bytes.
    Assert-RequiredField $Record 'schemaVersion' 'Artefact'
    Assert-RequiredField $Record 'repository' 'Artefact'
    Assert-RequiredField $Record 'sourceRevision' 'Artefact'
    Assert-RequiredField $Record 'recordedAt' 'Artefact'
    Assert-RequiredField $Record 'recordedBy' 'Artefact'
    Assert-RequiredField $Record 'collectorReportSha256' 'Artefact'
    Assert-RequiredField $Record 'verdict' 'Artefact'

    if ([string]$Record.repository -ne $Repository) {
        throw "Artefact repository mismatch: attendu=$Repository obtenu=$($Record.repository)"
    }
    $artifactSourceRevision = ([string]$Record.sourceRevision).ToLowerInvariant()
    if ($artifactSourceRevision -ne $CommitSha) {
        throw "Artefact sourceRevision mismatch: attendu=$CommitSha obtenu=$($Record.sourceRevision)"
    }
    if ([string]$Record.verdict -ne 'PASS_NATIVE_3_OF_3') {
        throw "Artefact verdict must be PASS_NATIVE_3_OF_3, obtenu=$($Record.verdict)"
    }
    if ([string]$Record.collectorReportSha256 -notmatch '^[a-fA-F0-9]{64}$') {
        throw "Artefact collectorReportSha256 invalide : $($Record.collectorReportSha256)"
    }

    $clients = @($Record.clients)
    if ($clients.Count -ne 3) {
        throw "Artefact doit contenir exactement 3 clients, obtenu=$($clients.Count)"
    }
    $clientNames = @($clients | ForEach-Object { [string]$_.client })
    if (@($clientNames | Sort-Object -Unique).Count -ne 3) {
        throw "Artefact contient des clients dupliqués ou invalides : $($clientNames -join ', ')"
    }
    foreach ($expected in $expectedClients) {
        if ($clientNames -notcontains $expected) {
            throw "Artefact ne certifie pas le client requis : $expected"
        }
    }
    foreach ($clientName in $clientNames) {
        if ($expectedClients -notcontains $clientName) {
            throw "Artefact certifie un client non attendu : $clientName"
        }
    }

    foreach ($client in $clients) {
        $label = [string]$client.client
        Assert-RequiredField $client 'searchRequestId' $label
        Assert-RequiredField $client 'readRequestId' $label
        if ([string]$client.searchRequestId -eq [string]$client.readRequestId) {
            throw "$label : searchRequestId et readRequestId doivent différer"
        }

        $searchSectionId = 0
        $readSectionId = 0
        if (-not [int]::TryParse([string]$client.searchSectionId, [ref]$searchSectionId) -or $searchSectionId -le 0) {
            throw "$label : searchSectionId invalide"
        }
        if (-not [int]::TryParse([string]$client.readSectionId, [ref]$readSectionId) -or $readSectionId -le 0) {
            throw "$label : readSectionId invalide"
        }
        if ($searchSectionId -ne $readSectionId) {
            throw "$label : sectionId mismatch (search=$searchSectionId read=$readSectionId)"
        }

        if (-not (Test-PropertyPresent $client 'sectionFound') -or [bool]$client.sectionFound -ne $true) {
            throw "$label : sectionFound doit être true"
        }
        if ([bool]$client.nativeToolInvocationObserved -ne $true) {
            throw "$label : nativeToolInvocationObserved doit être true"
        }
        if ([string]$client.verdict -ne 'PASS_NATIVE') {
            throw "$label : verdict doit être PASS_NATIVE"
        }

        $clientSourceRevision = [string]$client.sourceRevision
        if ($clientSourceRevision -notmatch '^[a-fA-F0-9]{40}$' -or $clientSourceRevision.ToLowerInvariant() -ne $CommitSha) {
            throw "$label : sourceRevision doit correspondre exactement au SHA certifié ($CommitSha), obtenu=$clientSourceRevision"
        }
    }
}

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

$expectedArtifactName = "native-client-certification-$CommitSha"
$downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mcp-native-cert-" + [guid]::NewGuid().ToString('N'))

foreach ($run in $candidates) {
    $artifacts = gh api "repos/$Repository/actions/runs/$($run.id)/artifacts?per_page=100" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { continue }
    $artifact = @(
        $artifacts.artifacts |
            Where-Object { [string]$_.name -eq $expectedArtifactName -and -not [bool]$_.expired }
    ) | Select-Object -First 1
    if ($null -eq $artifact) { continue }

    $runDownloadDir = Join-Path $downloadRoot "run-$($run.id)"
    New-Item -ItemType Directory -Force -Path $runDownloadDir | Out-Null
    gh run download $run.id --repo $Repository --name $expectedArtifactName --dir $runDownloadDir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Téléchargement de l'artefact échoué pour le run $($run.id) ; candidat suivant."
        continue
    }

    $jsonPath = Join-Path $runDownloadDir 'native-client-certification.json'
    if (-not (Test-Path -LiteralPath $jsonPath -PathType Leaf)) {
        Write-Warning "L'artefact téléchargé pour le run $($run.id) ne contient pas native-client-certification.json ; candidat suivant."
        continue
    }

    # From here on, a name-matching, non-expired, downloadable artifact has been found for the
    # exact SHA -- its CONTENT must now independently satisfy every invariant, or the whole
    # verification fails immediately. It is never sufficient for the artifact to merely exist.
    $artifactContent = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8
    try {
        $record = $artifactContent | ConvertFrom-Json
    } catch {
        throw "L'artefact native-client-certification du run $($run.id) contient un JSON invalide : $($_.Exception.Message)"
    }

    Assert-ValidNativeCertificationArtifact -Record $record -Repository $Repository -CommitSha $CommitSha

    Write-Host "NATIVE_CLIENT_CERTIFICATION_EXACT_HEAD_QUALIFIED run=$($run.id) artifact=$($artifact.id) sha=$CommitSha"
    exit 0
}

throw "Aucune certification native 3/3 valide et non expirée n'est liée au SHA exact $CommitSha. Exécutez '$workflow' sur master après les trois observations natives."
