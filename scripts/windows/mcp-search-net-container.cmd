@echo off
setlocal
if not defined MCP_SEARCH_HOME set "MCP_SEARCH_HOME=%LOCALAPPDATA%\mcp-search-net"
if not exist "%MCP_SEARCH_HOME%\compose.yaml" (
  1>&2 echo mcp-search-net: compose.yaml absent. Relancez scripts\install-user.ps1.
  exit /b 2
)
if not exist "%MCP_SEARCH_HOME%\.env" (
  1>&2 echo mcp-search-net: fichier .env absent. Relancez scripts\install-user.ps1.
  exit /b 3
)
where docker >nul 2>&1
if errorlevel 1 (
  1>&2 echo mcp-search-net: Docker est absent du PATH.
  exit /b 4
)

if not defined MCP_SEARCH_COMPOSE_PROJECT set "MCP_SEARCH_COMPOSE_PROJECT=mcp-search-net"

rem Meme projet Compose que le lanceur local : conserver les ports loopback de compose.hybrid.yaml.
set "MCP_SEARCH_COMPOSE_FILES=-f "%MCP_SEARCH_HOME%\compose.yaml""
if exist "%MCP_SEARCH_HOME%\compose.hybrid.yaml" set "MCP_SEARCH_COMPOSE_FILES=%MCP_SEARCH_COMPOSE_FILES% -f "%MCP_SEARCH_HOME%\compose.hybrid.yaml""

docker compose --env-file "%MCP_SEARCH_HOME%\.env" -p "%MCP_SEARCH_COMPOSE_PROJECT%" %MCP_SEARCH_COMPOSE_FILES% up -d --wait searxng crawl4ai 1>&2
if errorlevel 1 exit /b %ERRORLEVEL%
docker compose --env-file "%MCP_SEARCH_HOME%\.env" -p "%MCP_SEARCH_COMPOSE_PROJECT%" %MCP_SEARCH_COMPOSE_FILES% --profile stdio run --rm --no-deps -T mcp-search-net
exit /b %ERRORLEVEL%
