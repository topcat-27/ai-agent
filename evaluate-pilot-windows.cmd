@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\evaluate-pilot.ps1"
set "PILOT_STATUS=%ERRORLEVEL%"
echo.
echo You can close this window.
pause
exit /b %PILOT_STATUS%
