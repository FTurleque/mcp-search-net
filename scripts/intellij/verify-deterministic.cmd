@echo off
setlocal
call "%~dp0run-powershell.cmd" "%~dp0verify-deterministic.ps1"
exit /b %ERRORLEVEL%
