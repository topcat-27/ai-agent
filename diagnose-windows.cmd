@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\diagnose.ps1"
set "DIAGNOSTIC_STATUS=%ERRORLEVEL%"
echo.
echo You can close this window.
pause
exit /b %DIAGNOSTIC_STATUS%
