@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start.ps1"
if errorlevel 1 (
  echo.
  echo Start failed. Read the message above, then try again.
)
pause
