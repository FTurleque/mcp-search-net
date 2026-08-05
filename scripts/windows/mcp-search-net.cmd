@echo off
setlocal
if not defined MCP_SEARCH_HOME set "MCP_SEARCH_HOME=%LOCALAPPDATA%\mcp-search-net"
set "NODE_EXE=%MCP_SEARCH_HOME%\runtime\node-v24.18.0-win-x64\node.exe"
set "SERVER_JS=%MCP_SEARCH_HOME%\app\build\bootstrap\main.js"

if not exist "%NODE_EXE%" (
  1>&2 echo mcp-search-net: runtime Node.js absent. Relancez scripts\install-user.ps1.
  exit /b 2
)
if not exist "%SERVER_JS%" (
  1>&2 echo mcp-search-net: application absente. Relancez scripts\install-user.ps1.
  exit /b 3
)

if not defined MCP_CONFIG_PATH set "MCP_CONFIG_PATH=%MCP_SEARCH_HOME%\config\application.yml"
if not defined MCP_CATALOG_PATH set "MCP_CATALOG_PATH=%MCP_SEARCH_HOME%\data\catalog.db"
if not defined MCP_CRAWL4AI_TOKEN if exist "%MCP_SEARCH_HOME%\.env" for /f "tokens=1,* delims==" %%A in ('findstr /b /l "CRAWL4AI_API_TOKEN=" "%MCP_SEARCH_HOME%\.env"') do set "MCP_CRAWL4AI_TOKEN=%%B"
if not defined MCP_CRAWL4AI_TOKEN (
  1>&2 echo mcp-search-net: jeton Crawl4AI absent. Relancez install-user.ps1 ou définissez MCP_CRAWL4AI_TOKEN.
  exit /b 4
)

pushd "%MCP_SEARCH_HOME%" >nul 2>&1
if errorlevel 1 (
  1>&2 echo mcp-search-net: dossier d'installation inaccessible.
  exit /b 5
)
"%NODE_EXE%" "%SERVER_JS%"
set "MCP_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %MCP_EXIT_CODE%
