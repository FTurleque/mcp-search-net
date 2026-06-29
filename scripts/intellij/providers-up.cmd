@echo off
setlocal
call "%~dp0run-powershell.cmd" "%~dp0providers-up.ps1"
exit /b %ERRORLEVEL%
