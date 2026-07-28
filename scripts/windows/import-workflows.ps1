. (Join-Path $PSScriptRoot "Common.ps1")

if (-not (Test-Path $script:EnvFile)) {
    throw "Local setup has not been completed. Run setup-windows.cmd first."
}

Assert-DockerAvailable

Write-Host "Checking the workflow exports..."
& docker run --rm `
    -v "${script:ProjectRoot}:/workspace:ro" `
    -w /workspace `
    node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a `
    node scripts/validate-workflows.mjs
if ($LASTEXITCODE -ne 0) {
    throw "Workflow validation failed."
}

Write-Host "`nStarting n8n..."
Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240", "n8n")

Write-Host "`nImporting the reviewed workflows as inactive drafts..."
Invoke-Compose @(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:workflow",
    "--separate",
    "--input=/opt/ai-solopreneur/workflows"
)

$n8nPort = if ($env:N8N_PORT) {
    $env:N8N_PORT
}
else {
    Get-EnvValue "N8N_PORT" "5678"
}
$setupPublished = $false
$skillSyncPublished = $false

function Invoke-WebhookWhenReady {
    param(
        [string]$Uri,
        [string]$Body = "",
        [string]$ContentType = ""
    )

    $lastError = $null
    for ($attempt = 1; $attempt -le 30; $attempt += 1) {
        try {
            $parameters = @{
                Method = "Post"
                Uri = $Uri
            }
            if ($ContentType) {
                $parameters.ContentType = $ContentType
                $parameters.Body = $Body
            }
            return Invoke-RestMethod @parameters
        }
        catch {
            $lastError = $_
            if ($attempt -lt 30) {
                Start-Sleep -Seconds 1
            }
        }
    }

    throw "n8n became healthy but the published webhook was not ready after 30 seconds. $lastError"
}

try {
    Write-Host "`nPreparing local data, enabled skills, and reviewed tool dependencies..."
    Invoke-Compose @(
        "exec",
        "-T",
        "n8n",
        "n8n",
        "publish:workflow",
        "--id=phase4TaskSetup"
    ) *> $null
    $setupPublished = $true

    Invoke-Compose @(
        "exec",
        "-T",
        "n8n",
        "n8n",
        "publish:workflow",
        "--id=phase5SyncEnabledSkills"
    ) *> $null
    $skillSyncPublished = $true

    $runtimeWorkflowIds = @(
        "phase4ListTasks",
        "phase4CreateTask",
        "phase4UpdateTaskStatus",
        "phase5ProposeCreateTask",
        "phase5ProposeTaskStatus",
        "phase5ConfirmTaskWrite"
    )
    foreach ($workflowId in $runtimeWorkflowIds) {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "publish:workflow",
            "--id=$workflowId"
        ) *> $null
    }

    Invoke-Compose @("restart", "n8n") *> $null
    Invoke-Compose @("up", "-d", "--wait", "--wait-timeout", "240", "n8n") *> $null

    $setupResult = Invoke-WebhookWhenReady `
        -Uri "http://127.0.0.1:$n8nPort/webhook/setup-task-data"
    if (-not $setupResult.ok) {
        throw "Local task setup returned an unexpected response."
    }

    $skillBundle = (& docker run --rm `
        -v "${script:ProjectRoot}:/workspace:ro" `
        -w /workspace `
        node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a `
        node scripts/compile-skills.mjs | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Enabled skill validation failed."
    }

    $skillResult = Invoke-WebhookWhenReady `
        -Uri "http://127.0.0.1:$n8nPort/webhook/sync-enabled-skills" `
        -ContentType "application/json" `
        -Body $skillBundle
    if (-not $skillResult.ok) {
        throw "Enabled skill sync returned an unexpected response."
    }
}
finally {
    if ($setupPublished) {
        Write-Host "`nRemoving the temporary local setup webhook..."
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "unpublish:workflow",
            "--id=phase4TaskSetup"
        ) *> $null
    }
    if ($skillSyncPublished) {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "unpublish:workflow",
            "--id=phase5SyncEnabledSkills"
        ) *> $null
    }
    if ($setupPublished -or $skillSyncPublished) {
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

Write-Host "`nWorkflows imported successfully." -ForegroundColor Green
Write-Host "Local task tables and three sample tasks are ready."
Write-Host "Enabled Markdown skills are synced into the agent."
Write-Host "Open http://localhost:$n8nPort and follow docs/N8N_AGENT_SETUP.md."
Write-Host "The main agent stays inactive until you select your Anthropic credential and publish it."
