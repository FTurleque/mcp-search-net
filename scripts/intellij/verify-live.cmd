@echo off
setlocal
call "%~dp0run-powershell.cmd" "%~dp0verify-live.ps1"
exit /b %ERRORLEVEL%
