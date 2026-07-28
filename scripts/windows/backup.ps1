. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    throw "Cannot back up before local setup. Run setup-windows.cmd first."
}

Assert-DockerAvailable

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path (Join-Path $script:ProjectRoot "backups") $timestamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$wasRunning = Test-ServiceRunning "n8n"
try {
    if ($wasRunning) {
        Invoke-Compose @("stop", "n8n") *> $null
    }

    Invoke-Compose @(
        "run",
        "--rm",
        "--no-deps",
        "--user",
        "0:0",
        "-v",
        "${backupDir}:/backup",
        "--entrypoint",
        "/bin/sh",
        "n8n",
        "-c",
        "tar -czf /backup/n8n-data.tar.gz -C /home/node/.n8n ."
    )

    Copy-Item $script:EnvFile (Join-Path $backupDir "env.backup")
}
finally {
    if ($wasRunning) {
        Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240") *> $null
    }
}

Write-Host "Backup created at:`n  $backupDir" -ForegroundColor Green
Write-Host "It contains encrypted credentials and the encryption key. Keep it private."
