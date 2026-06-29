@echo off
setlocal
call "%~dp0run-powershell.cmd" "%~dp0..\install-user.ps1" -StartServices -RunAfterInstall
exit /b %ERRORLEVEL%
