@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
set "AMU_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %AMU_EXIT_CODE%
