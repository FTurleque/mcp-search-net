@echo off
setlocal

if "%~1"=="" (
  1>&2 echo Usage: run-powershell.cmd script.ps1 [arguments...]
  exit /b 64
)

set "SCRIPT=%~1"
shift /1

set "PS_EXE="
for %%P in (pwsh.exe powershell.exe) do (
  if not defined PS_EXE (
    for /f "delims=" %%F in ('where %%P 2^>nul') do (
      if not defined PS_EXE set "PS_EXE=%%F"
    )
  )
)

if not defined PS_EXE (
  1>&2 echo PowerShell introuvable: ni pwsh.exe ni powershell.exe ne sont dans le PATH.
  exit /b 127
)

set "ARGS="
:collect
if "%~1"=="" goto run
set "ARGS=%ARGS% "%~1""
shift /1
goto collect

:run
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %ARGS%
exit /b %ERRORLEVEL%
