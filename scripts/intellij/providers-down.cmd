@echo off
setlocal
call "%~dp0run-powershell.cmd" "%~dp0providers-down.ps1"
exit /b %ERRORLEVEL%
