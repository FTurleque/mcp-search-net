@echo off
setlocal
if not defined MCP_SEARCH_HOME set "MCP_SEARCH_HOME=%LOCALAPPDATA%\mcp-search-net"
set "NODE_EXE=%MCP_SEARCH_HOME%\runtime\node-v24.17.0-win-x64\node.exe"
set "SERVER_JS=%MCP_SEARCH_HOME%\app\dist\bootstrap\main.js"

if not exist "%NODE_EXE%" (
  1>&2 echo mcp-search-net: runtime Node.js absent. Relancez scripts\install-user.ps1.
  exit /b 2
)
if not exist "%SERVER_JS%" (
  1>&2 echo mcp-search-net: application absente. Relancez scripts\install-user.ps1.
  exit /b 3
)

if not defined MCP_SEARCH_CONFIG set "MCP_SEARCH_CONFIG=%MCP_SEARCH_HOME%\config\application.yml"
if not defined CRAWL4AI_API_TOKEN set "CRAWL4AI_API_TOKEN=mcp-search-local-development-token"

"%NODE_EXE%" "%SERVER_JS%"
exit /b %ERRORLEVEL%
