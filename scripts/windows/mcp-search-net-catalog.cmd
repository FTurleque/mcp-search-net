@echo off
setlocal
if not defined MCP_SEARCH_HOME set "MCP_SEARCH_HOME=%LOCALAPPDATA%\mcp-search-net"
set "NODE_EXE=%MCP_SEARCH_HOME%\runtime\node-v24.17.0-win-x64\node.exe"
set "CATALOG_JS=%MCP_SEARCH_HOME%\app\build\cli\catalog.js"
if not exist "%NODE_EXE%" (
  1>&2 echo mcp-search-net: runtime Node.js absent. Relancez scripts\install-user.ps1.
  exit /b 2
)
if not exist "%CATALOG_JS%" (
  1>&2 echo mcp-search-net: CLI catalogue absente. Relancez scripts\install-user.ps1.
  exit /b 3
)
if not defined MCP_CATALOG_PATH set "MCP_CATALOG_PATH=%MCP_SEARCH_HOME%\data\catalog.db"
pushd "%MCP_SEARCH_HOME%" >nul 2>&1
if errorlevel 1 (
  1>&2 echo mcp-search-net: dossier d'installation inaccessible.
  exit /b 5
)
"%NODE_EXE%" "%CATALOG_JS%" %*
set "MCP_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %MCP_EXIT_CODE%
