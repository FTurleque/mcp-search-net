@echo off
setlocal
if not defined MCP_SEARCH_HOME set "MCP_SEARCH_HOME=%LOCALAPPDATA%\mcp-search-net"
if not exist "%MCP_SEARCH_HOME%\compose.yaml" (
  1>&2 echo mcp-search-net: compose.yaml absent. Relancez scripts\install-user.ps1.
  exit /b 2
)
if not defined MCP_SEARCH_COMPOSE_PROJECT set "MCP_SEARCH_COMPOSE_PROJECT=mcp-search-net"
docker compose -p "%MCP_SEARCH_COMPOSE_PROJECT%" -f "%MCP_SEARCH_HOME%\compose.yaml" -f "%MCP_SEARCH_HOME%\compose.hybrid.yaml" %*
exit /b %ERRORLEVEL%
