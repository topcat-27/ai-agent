@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\import-workflows.ps1"
if errorlevel 1 (
  echo.
  echo Workflow import failed. Read the message above, then try again.
)
pause
