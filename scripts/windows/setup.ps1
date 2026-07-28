. (Join-Path $PSScriptRoot "Common.ps1")

function Test-ReviewedWorkflowsInstalled {
    $diagnosticPath = "/tmp/ai-solopreneur-setup-checklist.json"
    try {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "export:workflow",
            "--id=phase6LearnerChecklist",
            "--output=$diagnosticPath"
        ) *> $null

        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "node",
            "-e",
            "const fs=require('fs'); const raw=JSON.parse(fs.readFileSync('$diagnosticPath','utf8')); const workflows=Array.isArray(raw)?raw:[raw]; process.exit(workflows.some((workflow)=>workflow.id==='phase6LearnerChecklist')?0:1);"
        ) *> $null
        return $true
    }
    catch {
        return $false
    }
    finally {
        try {
            Invoke-Compose @(
                "exec",
                "-T",
                "n8n",
                "sh",
                "-c",
                "rm -f -- '$diagnosticPath'"
            ) *> $null
        }
        catch {
            # A missing temporary file is safe to ignore.
        }
    }
}

if (-not (Test-Path $script:EnvFile)) {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    $encryptionKey = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $content = @(
        "COMPOSE_PROJECT_NAME=ai-solopreneur"
        "CHAT_PORT=3000"
        "N8N_PORT=5678"
        "GENERIC_TIMEZONE=Australia/Melbourne"
        "N8N_ENCRYPTION_KEY=$encryptionKey"
    ) -join [Environment]::NewLine

    [IO.File]::WriteAllText(
        $script:EnvFile,
        "$content$([Environment]::NewLine)",
        [Text.UTF8Encoding]::new($false)
    )
    Write-Host "Created a private .env file with a generated n8n encryption key."
}
else {
    $existingKey = Get-EnvValue "N8N_ENCRYPTION_KEY" ""
    if ($existingKey.Length -lt 32 -or $existingKey.StartsWith("replace-")) {
        $bytes = New-Object byte[] 32
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $generator.GetBytes($bytes)
        }
        finally {
            $generator.Dispose()
        }

        $replacementKey = -join ($bytes | ForEach-Object { $_.ToString("x2") })
        $lines = @(Get-Content $script:EnvFile)
        $replaced = $false
        $updatedLines = foreach ($line in $lines) {
            if ($line -match "^N8N_ENCRYPTION_KEY=") {
                "N8N_ENCRYPTION_KEY=$replacementKey"
                $replaced = $true
            }
            else {
                $line
            }
        }
        if (-not $replaced) {
            $updatedLines += "N8N_ENCRYPTION_KEY=$replacementKey"
        }

        [IO.File]::WriteAllText(
            $script:EnvFile,
            (($updatedLines -join [Environment]::NewLine) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false)
        )
        Write-Host "Replaced the example encryption-key placeholder with a private generated key."
    }
    else {
        Write-Host "Using the existing private .env file."
    }
}

& (Join-Path $PSScriptRoot "preflight.ps1")

Write-Host "`nDownloading the pinned local images..."
Invoke-Compose @("pull", "n8n")

Write-Host "`nBuilding the local chat app..."
Invoke-Compose @("build", "chat")

Write-Host "`nStarting AI Solopreneur..."
Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240")

if (Test-ReviewedWorkflowsInstalled) {
    Write-Host "`nThe reviewed workflows are already installed; keeping local edits unchanged."
}
else {
    Write-Host "`nInstalling the reviewed workflows, sample data, and enabled skills..."
    try {
        & (Join-Path $PSScriptRoot "import-workflows.ps1")
    }
    catch {
        Write-Host "`nAutomatic workflow import did not finish." -ForegroundColor Red
        Write-Host "The local services are still available. Fix the message above, then double-click import-workflows-windows.cmd."
        throw
    }
}

$chatPort = Get-EnvValue "CHAT_PORT" "3000"
$n8nPort = Get-EnvValue "N8N_PORT" "5678"

Wait-Endpoint "http://127.0.0.1:$chatPort/health"
Wait-Endpoint "http://127.0.0.1:$n8nPort/healthz"

Write-Host "`nLocal stack is healthy." -ForegroundColor Green
Write-Host "  Chat app:          http://localhost:$chatPort"
Write-Host "  n8n editor:       http://localhost:$n8nPort"
Write-Host "  Next: create the local n8n owner, then open 01 - START HERE - Learner Checklist."
