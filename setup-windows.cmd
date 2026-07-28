@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. Read the message above, then try again.
)
pause
