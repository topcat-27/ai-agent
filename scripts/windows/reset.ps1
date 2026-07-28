. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    Write-Host "Nothing to reset because local setup has not been completed."
    exit 0
}

Write-Host "This permanently removes local n8n users, credentials, workflows, and history." -ForegroundColor Yellow
Write-Host "Create a backup first if any of that data matters."
$answer = Read-Host "Type RESET to continue"
if ($answer -ne "RESET") {
    Write-Host "Reset cancelled."
    exit 0
}

Invoke-Compose @("down", "--volumes", "--remove-orphans")
Write-Host "Local n8n data has been removed. The private .env file was preserved."
Write-Host "Run start-windows.cmd to create a fresh local instance."
