@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\reset.ps1"
if errorlevel 1 (
  echo.
  echo Reset failed. Review the message above.
  pause
  exit /b 1
)
echo.
echo You can close this window.
pause
