param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
)

. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    throw "Run local setup once before restoring a backup."
}

$backupDir = (Resolve-Path $BackupDirectory).Path
$archive = Join-Path $backupDir "n8n-data.tar.gz"
$environmentBackup = Join-Path $backupDir "env.backup"

if (-not (Test-Path $archive) -or -not (Test-Path $environmentBackup)) {
    throw "Backup is incomplete. Expected n8n-data.tar.gz and env.backup."
}

Write-Host "This replaces all current local n8n users, credentials, workflows, and history." -ForegroundColor Yellow
$answer = Read-Host "Type RESTORE to continue"
if ($answer -ne "RESTORE") {
    Write-Host "Restore cancelled."
    exit 0
}

Assert-DockerAvailable
Invoke-Compose @("stop") *> $null
Copy-Item $environmentBackup $script:EnvFile -Force

Invoke-Compose @(
    "run",
    "--rm",
    "--no-deps",
    "--user",
    "0:0",
    "-v",
    "${backupDir}:/backup:ro",
    "--entrypoint",
    "/bin/sh",
    "n8n",
    "-c",
    "find /home/node/.n8n -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/n8n-data.tar.gz -C /home/node/.n8n"
)

Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240")
Write-Host "Backup restored and the local stack is healthy." -ForegroundColor Green
