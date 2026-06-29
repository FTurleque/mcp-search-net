@echo off
setlocal
call "%~dp0run-powershell.cmd" "%~dp0run-local-mcp.ps1" -StartServices
exit /b %ERRORLEVEL%
