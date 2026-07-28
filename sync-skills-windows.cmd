@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\sync-skills.ps1"
if errorlevel 1 (
  echo.
  echo Skill sync did not complete. Review the message above.
  pause
  exit /b 1
)
echo.
echo You can close this window.
pause
