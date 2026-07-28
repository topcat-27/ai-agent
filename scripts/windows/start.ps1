. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    throw "Local setup has not been completed. Run setup-windows.cmd first."
}

& (Join-Path $PSScriptRoot "preflight.ps1")
Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240")

$chatPort = Get-EnvValue "CHAT_PORT" "3000"
$n8nPort = Get-EnvValue "N8N_PORT" "5678"

Wait-Endpoint "http://127.0.0.1:$chatPort/health"
Wait-Endpoint "http://127.0.0.1:$n8nPort/healthz"

Write-Host "AI Solopreneur is healthy." -ForegroundColor Green
Write-Host "  Chat app:          http://localhost:$chatPort"
Write-Host "  n8n editor:       http://localhost:$n8nPort"
