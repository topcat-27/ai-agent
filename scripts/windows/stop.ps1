. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    Write-Host "Nothing to stop because local setup has not been completed."
    exit 0
}

Invoke-Compose @("stop")
Write-Host "AI Solopreneur is stopped. Local data is preserved."
