@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"
set "TARGET=%SCRIPT_DIR%..\install-user.ps1"

if not exist "%TARGET%" (
  1>&2 echo Script introuvable: "%TARGET%"
  exit /b 66
)

pushd "%REPO_ROOT%" || exit /b 1
call "%SCRIPT_DIR%run-powershell.cmd" "%TARGET%" -StartServices 1>&2
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  popd
  exit /b %EXITCODE%
)

set "LAUNCHER=%LOCALAPPDATA%\mcp-search-net\bin\mcp-search-net.cmd"
if not exist "%LAUNCHER%" (
  1>&2 echo Lanceur MCP introuvable apres installation: "%LAUNCHER%"
  popd
  exit /b 67
)

1>&2 echo Demarrage du serveur MCP STDIO installe (arreter avec Ctrl+C)...
call "%LAUNCHER%"
set "EXITCODE=%ERRORLEVEL%"
popd
exit /b %EXITCODE%
