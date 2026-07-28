@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\stop.ps1"
if errorlevel 1 (
  echo.
  echo Stop failed. Read the message above, then try again.
)
pause
