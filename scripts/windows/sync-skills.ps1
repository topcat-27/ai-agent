. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    throw "Local setup has not been completed. Run setup-windows.cmd first."
}

Assert-DockerAvailable

if (-not (Test-ServiceRunning "n8n")) {
    throw "n8n is not running. Start the local stack first."
}

$n8nPort = if ($env:N8N_PORT) {
    $env:N8N_PORT
}
else {
    Get-EnvValue "N8N_PORT" "5678"
}

Write-Host "Validating and compiling enabled skills..."
$skillBundle = (& docker run --rm `
    -v "${script:ProjectRoot}:/workspace:ro" `
    -w /workspace `
    node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a `
    node scripts/compile-skills.mjs | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Enabled skill validation failed."
}

$skillSyncPublished = $false
try {
    Write-Host "Opening the temporary localhost skill-sync endpoint..."
    Invoke-Compose @(
        "exec",
        "-T",
        "n8n",
        "n8n",
        "publish:workflow",
        "--id=phase5SyncEnabledSkills"
    ) *> $null
    $skillSyncPublished = $true
    Invoke-Compose @("restart", "n8n") *> $null
    Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240", "n8n") *> $null

    $result = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:$n8nPort/webhook/sync-enabled-skills" `
        -ContentType "application/json" `
        -Body $skillBundle
    if (-not $result.ok) {
        throw "Enabled skill sync returned an unexpected response."
    }
}
finally {
    if ($skillSyncPublished) {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "unpublish:workflow",
            "--id=phase5SyncEnabledSkills"
        ) *> $null
        Invoke-Compose @("restart", "n8n") *> $null
        Invoke-Compose @(
            "up",
            "-d",
            "--wait",
            "--wait-timeout",
            "240",
            "n8n"
        ) *> $null
    }
}

Write-Host "Enabled skills synced successfully." -ForegroundColor Green
Write-Host "Open http://localhost:$n8nPort and start a new browser conversation."
