[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\packaging\windows\configure-install.ps1'
$path = [System.IO.Path]::GetFullPath($path)
$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"

function Replace-Required {
    param(
        [Parameter(Mandatory)] [string] $Old,
        [Parameter(Mandatory)] [string] $New,
        [Parameter(Mandatory)] [string] $Label
    )

    $oldNormalized = $Old -replace "`r`n", "`n"
    $newNormalized = $New -replace "`r`n", "`n"
    if (-not $script:text.Contains($oldNormalized)) {
        throw "Patch anchor missing: $Label"
    }
    $script:text = $script:text.Replace($oldNormalized, $newNormalized)
}

$old = @'
$BinLauncher       = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$ContainerLauncher = Join-Path $InstallRoot 'bin\mcp-search-net-container.cmd'

if (-not $Uninstall) {
'@
$new = @'
$BinLauncher       = Join-Path $InstallRoot 'bin\mcp-search-net.cmd'
$ContainerLauncher = Join-Path $InstallRoot 'bin\mcp-search-net-container.cmd'
$ClientConfigPath  = Join-Path $InstallRoot 'config\application.yml'
$ClientCatalogPath = Join-Path $InstallRoot 'data\catalog.db'

function New-ManagedClientEnv {
    return [ordered]@{
        MCP_SEARCH_HOME  = $InstallRoot
        MCP_CONFIG_PATH  = $ClientConfigPath
        MCP_CATALOG_PATH = $ClientCatalogPath
    }
}

if (-not $Uninstall) {
'@
Replace-Required -Old $old -New $new -Label 'managed client environment helper'

$old = @'
                args    = @('/d', '/s', '/c', $BinLauncher)
                env     = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
                tools   = @('*')
'@
$new = @'
                args    = @('/d', '/s', '/c', $BinLauncher)
                env     = (New-ManagedClientEnv)
                tools   = @('*')
'@
Replace-Required -Old $old -New $new -Label 'mcp example confinement'

$old = @'
$JetBrainsEntry = [PSCustomObject]@{
    type    = 'stdio'
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = [PSCustomObject]@{ MCP_SEARCH_HOME = $InstallRoot }
}
'@
$new = @'
$JetBrainsEntry = [PSCustomObject]@{
    type    = 'stdio'
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = (New-ManagedClientEnv)
}
'@
Replace-Required -Old $old -New $new -Label 'JetBrains confinement'

$old = @'
$DesktopEntry = [PSCustomObject]@{
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = [PSCustomObject]@{ MCP_SEARCH_HOME = $InstallRoot }
}
'@
$new = @'
$DesktopEntry = [PSCustomObject]@{
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = (New-ManagedClientEnv)
}
'@
Replace-Required -Old $old -New $new -Label 'Claude Desktop confinement'

$old = @'
  } elseif ($listed -and $alreadyManaged) {
      Write-Host "  Claude Code : 'mcp-search-net' déjà configuré et vérifié (scope=user)." -ForegroundColor Cyan
  } else {
      if ($alreadyManaged) { $integrations.Remove($integKeyCC) }

      # add-json avoids the version-dependent --env parser used by `mcp add`.
'@
$new = @'
  } else {
      if ($alreadyManaged) {
          $rRm = Invoke-ExternalProcess $ClaudeExe @('mcp', 'remove', '--scope', 'user', 'mcp-search-net') 15
          if (-not ($rRm.Done -and $rRm.ExitCode -eq 0)) {
              throw "Impossible de migrer l'entrée Claude Code gérée : $(Get-SafeProcessSummary $rRm)"
          }
          $integrations.Remove($integKeyCC)
      }

      # add-json avoids the version-dependent --env parser used by `mcp add`.
'@
Replace-Required -Old $old -New $new -Label 'Claude managed migration'

$old = @'
      $claudePayload = [ordered]@{
          type    = 'stdio'
          command = 'cmd.exe'
          args    = @('/d', '/s', '/c', $BinLauncher)
          env     = [ordered]@{ MCP_SEARCH_HOME = $InstallRoot }
      }
'@
$new = @'
      $claudePayload = [ordered]@{
          type    = 'stdio'
          command = 'cmd.exe'
          args    = @('/d', '/s', '/c', $BinLauncher)
          env     = (New-ManagedClientEnv)
      }
'@
Replace-Required -Old $old -New $new -Label 'Claude payload confinement'

$old = @'
$CopilotCliEntry  = [PSCustomObject]@{
    type    = 'stdio'
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = [PSCustomObject]@{ MCP_SEARCH_HOME = $InstallRoot }
    tools   = @('*')
}
'@
$new = @'
$CopilotCliEntry  = [PSCustomObject]@{
    type    = 'stdio'
    command = 'cmd.exe'
    args    = @('/d', '/s', '/c', $BinLauncher)
    env     = (New-ManagedClientEnv)
    tools   = @('*')
}
'@
Replace-Required -Old $old -New $new -Label 'Copilot CLI confinement'

$old = @'
  } elseif ($listed -and $alreadyManaged) {
      Write-Host "  Copilot CLI : 'mcp-search-net' déjà configuré et vérifié." -ForegroundColor Cyan
  } else {
      $data = Read-JsonFile $CopilotCliConfig
'@
$new = @'
  } else {
      $data = Read-JsonFile $CopilotCliConfig
'@
Replace-Required -Old $old -New $new -Label 'Copilot managed migration'

$old = @'
    $envLine  = 'MCP_SEARCH_HOME = "' + $InstallRoot.Replace('\', '\\') + '"'
    return ($CodexBeginMark,
            '[mcp_servers.mcp-search-net]',
            $cmdLine, $argsLine, 'enabled = true', '',
            '[mcp_servers.mcp-search-net.env]',
            $envLine,
            $CodexEndMark) -join [Environment]::NewLine
'@
$new = @'
    $homeEnvLine    = 'MCP_SEARCH_HOME = "' + $InstallRoot.Replace('\', '\\') + '"'
    $configEnvLine  = 'MCP_CONFIG_PATH = "' + $ClientConfigPath.Replace('\', '\\') + '"'
    $catalogEnvLine = 'MCP_CATALOG_PATH = "' + $ClientCatalogPath.Replace('\', '\\') + '"'
    return ($CodexBeginMark,
            '[mcp_servers.mcp-search-net]',
            $cmdLine, $argsLine, 'enabled = true', '',
            '[mcp_servers.mcp-search-net.env]',
            $homeEnvLine, $configEnvLine, $catalogEnvLine,
            $CodexEndMark) -join [Environment]::NewLine
'@
Replace-Required -Old $old -New $new -Label 'Codex confinement'

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($path, $text, $utf8Bom)

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    $path,
    [ref]$tokens,
    [ref]$parseErrors
) | Out-Null
if (@($parseErrors).Count -gt 0) {
    $details = @($parseErrors | ForEach-Object {
        "line=$($_.Extent.StartLineNumber) col=$($_.Extent.StartColumnNumber) message=$($_.Message)"
    }) -join '; '
    throw "Patched configure-install.ps1 does not parse: $details"
}

Write-Host 'NATIVE_CLIENT_PATH_CONFINEMENT_PATCH_VALID'
