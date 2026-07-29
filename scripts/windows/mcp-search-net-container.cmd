@echo off
setlocal
if not defined MCP_SEARCH_HOME set "MCP_SEARCH_HOME=%LOCALAPPDATA%\mcp-search-net"
if not exist "%MCP_SEARCH_HOME%\compose.yaml" (
  1>&2 echo mcp-search-net: compose.yaml absent. Relancez scripts\install-user.ps1.
  exit /b 2
)

if not defined MCP_SEARCH_COMPOSE_PROJECT set "MCP_SEARCH_COMPOSE_PROJECT=mcp-search-net"

docker compose --env-file "%MCP_SEARCH_HOME%\.env" -p "%MCP_SEARCH_COMPOSE_PROJECT%" -f "%MCP_SEARCH_HOME%\compose.yaml" up -d --wait searxng crawl4ai 1>&2
if errorlevel 1 exit /b %ERRORLEVEL%
docker compose --env-file "%MCP_SEARCH_HOME%\.env" -p "%MCP_SEARCH_COMPOSE_PROJECT%" -f "%MCP_SEARCH_HOME%\compose.yaml" --profile stdio run --rm --no-deps -T mcp-search-net
exit /b %ERRORLEVEL%
