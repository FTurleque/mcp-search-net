$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$HooksSource = Join-Path $RepositoryRoot 'scripts/git-hooks'
$GitHooksTarget = Join-Path $RepositoryRoot '.git/hooks'

if (-not (Test-Path -LiteralPath $GitHooksTarget)) {
    throw "Dossier Git hooks introuvable : $GitHooksTarget"
}

$hooks = @('pre-commit', 'pre-push')

foreach ($hook in $hooks) {
    $source = Join-Path $HooksSource $hook
    $target = Join-Path $GitHooksTarget $hook
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Modele de hook introuvable : $source"
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Hook installe : $target"
}

Write-Host 'Hooks locaux installes.'
Write-Host 'Branches protegees localement : master, main, release/*'
Write-Host 'Tag protege localement : v1.0.0'
