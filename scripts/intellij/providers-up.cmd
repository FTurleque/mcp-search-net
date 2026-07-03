@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"
set "TARGET=%SCRIPT_DIR%providers-up.ps1"

if not exist "%TARGET%" (
  1>&2 echo Script introuvable: "%TARGET%"
  exit /b 66
)

pushd "%REPO_ROOT%" || exit /b 1
call "%SCRIPT_DIR%run-powershell.cmd" "%TARGET%"
set "EXITCODE=%ERRORLEVEL%"
popd
exit /b %EXITCODE%
