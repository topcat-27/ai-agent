. (Join-Path $PSScriptRoot "Common.ps1")

$failures = 0
$actions = 0
$n8nRunning = $false
$mainInstalled = $false
$mainExport = "/tmp/ai-solopreneur-diagnostic-main.json"
$checklistExport = "/tmp/ai-solopreneur-diagnostic-checklist.json"
$credentialExport = "/tmp/ai-solopreneur-diagnostic-credentials.json"

function Write-Next {
    param([string]$Message)
    Write-Host "  [next] $Message" -ForegroundColor Yellow
    $script:actions += 1
}

function Add-Failure {
    param([string]$Message)
    Write-Failure $Message
    $script:failures += 1
}

function Test-Endpoint {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Export-WorkflowById {
    param(
        [string]$WorkflowId,
        [string]$OutputPath
    )
    try {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "export:workflow",
            "--id=$WorkflowId",
            "--output=$OutputPath"
        ) *> $null
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "node",
            "-e",
            "const fs=require('fs'); const raw=JSON.parse(fs.readFileSync('$OutputPath','utf8')); const rows=Array.isArray(raw)?raw:[raw]; process.exit(rows.some((row)=>row.id==='$WorkflowId')?0:1);"
        ) *> $null
        return $true
    }
    catch {
        return $false
    }
}

function Test-WorkflowActive {
    param(
        [string]$WorkflowId,
        [string]$OutputPath
    )
    try {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "node",
            "-e",
            "const fs=require('fs'); const raw=JSON.parse(fs.readFileSync('$OutputPath','utf8')); const rows=Array.isArray(raw)?raw:[raw]; const row=rows.find((item)=>item.id==='$WorkflowId'); process.exit(row?.active===true?0:1);"
        ) *> $null
        return $true
    }
    catch {
        return $false
    }
}

function Test-ClaudeCredentialSelected {
    try {
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "n8n",
            "export:credentials",
            "--all",
            "--output=$credentialExport"
        ) *> $null
        Invoke-Compose @(
            "exec",
            "-T",
            "n8n",
            "node",
            "-e",
            "const fs=require('fs'); const workflowRaw=JSON.parse(fs.readFileSync('$mainExport','utf8')); const workflows=Array.isArray(workflowRaw)?workflowRaw:[workflowRaw]; const workflow=workflows.find((row)=>row.id==='phase3StartHere'); const reference=workflow?.nodes?.find((node)=>node.name==='Claude - Sonnet 4.6')?.credentials?.anthropicApi; const credentialRaw=JSON.parse(fs.readFileSync('$credentialExport','utf8')); const credentials=Array.isArray(credentialRaw)?credentialRaw:[credentialRaw]; const found=reference?.id&&credentials.some((credential)=>credential.id===reference.id&&credential.type==='anthropicApi'); process.exit(found?0:1);"
        ) *> $null
        return $true
    }
    catch {
        return $false
    }
}

function Get-AgentDiagnosticStatus {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri $Url `
            -ContentType "application/json" `
            -Body '{"sessionId":"diagnostic","message":"diagnostic"}' `
            -TimeoutSec 5
        return [int]$response.StatusCode
    }
    catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            return [int]$_.Exception.Response.StatusCode
        }
        return 0
    }
}

Write-Host "AI Solopreneur diagnostics"
Write-Host "This check never calls Claude or displays credential values.`n"

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Ok "Docker command is available."
}
else {
    Add-Failure "Docker Desktop is not installed or Docker is not on PATH."
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker Desktop is running."
    }
    else {
        Add-Failure "Docker Desktop is not running. Open it, wait for Ready, then rerun diagnostics."
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker Compose is available."
    }
    else {
        Add-Failure "Docker Compose is unavailable. Update Docker Desktop."
    }
}

if (Test-Path $script:EnvFile) {
    Write-Ok "Private local configuration exists."
    try {
        Invoke-Compose @("config", "--quiet") *> $null
        Write-Ok "Docker Compose configuration is valid."
    }
    catch {
        Add-Failure "Docker Compose configuration is invalid. Compare .env with .env.example."
    }
}
else {
    Add-Failure "Local setup has not run. Double-click setup-windows.cmd first."
}

if ($failures -eq 0) {
    $n8nRunning = Test-ServiceRunning "n8n"
    if ($n8nRunning) {
        Write-Ok "n8n container is running."
    }
    else {
        Add-Failure "n8n is not running. Double-click start-windows.cmd, then rerun diagnostics."
    }

    if (Test-ServiceRunning "chat") {
        Write-Ok "Chat container is running."
    }
    else {
        Add-Failure "The chat service is not running. Double-click start-windows.cmd, then rerun diagnostics."
    }
}

$chatPort = Get-EnvValue "CHAT_PORT" "3000"
$n8nPort = Get-EnvValue "N8N_PORT" "5678"

if (Test-Endpoint "http://127.0.0.1:$n8nPort/healthz") {
    Write-Ok "n8n health endpoint responds."
}
else {
    Add-Failure "n8n is not healthy at localhost:$n8nPort."
}

if (Test-Endpoint "http://127.0.0.1:$chatPort/health") {
    Write-Ok "Chat health endpoint responds."
}
else {
    Add-Failure "The chat is not healthy at localhost:$chatPort."
}

try {
    if ($n8nRunning) {
        if (Export-WorkflowById "phase6LearnerChecklist" $checklistExport) {
            Write-Ok "The learner checklist is installed."
        }
        else {
            Write-Next "Install the reviewed workflows by double-clicking import-workflows-windows.cmd."
        }

        $mainInstalled = Export-WorkflowById "phase3StartHere" $mainExport
        if ($mainInstalled) {
            Write-Ok "The Project Partner workflow is installed."

            if (Test-WorkflowActive "phase3StartHere" $mainExport) {
                Write-Ok "The Project Partner workflow is published."
            }
            else {
                Write-Next "Open 00 - START HERE - Project Partner in n8n, select the Claude credential, and publish it."
            }

            if (Test-ClaudeCredentialSelected) {
                Write-Ok "An Anthropic credential exists and is selected by the Claude node."
            }
            else {
                Write-Next "Create an Anthropic credential named Anthropic account and select it in Claude - Sonnet 4.6."
            }

            if ((Get-AgentDiagnosticStatus "http://127.0.0.1:$n8nPort/webhook/chat") -eq 400) {
                Write-Ok "The published chat webhook safely rejected the credential-free diagnostic request."
            }
            else {
                Write-Next "Publish 00 - START HERE - Project Partner so the chat webhook becomes available."
            }
        }
        else {
            Write-Next "Install the Project Partner workflow with import-workflows-windows.cmd."
        }

        if (Test-Endpoint "http://127.0.0.1:$n8nPort/webhook/agent-health") {
            Write-Ok "The optional agent-health workflow is published."
        }
        else {
            Write-Next "Publish 90 - DEBUG - Agent Health for the safe local health check."
        }
    }
}
finally {
    if ($n8nRunning) {
        try {
            Invoke-Compose @(
                "exec",
                "-T",
                "n8n",
                "sh",
                "-c",
                "rm -f -- '$mainExport' '$checklistExport' '$credentialExport'"
            ) *> $null
        }
        catch {
            # A missing temporary file is safe to ignore.
        }
    }
}

Write-Host
if ($failures -gt 0) {
    Write-Host "Diagnostics found $failures local service problem(s) and $actions setup action(s)." -ForegroundColor Red
    throw "Start with the [!!] lines, then run this helper again."
}

if ($actions -gt 0) {
    Write-Host "The local services are healthy. Complete $actions [next] action(s), then run diagnostics again." -ForegroundColor Yellow
    exit 1
}

Write-Host "All checks are green. The local agent is ready for a real Claude message." -ForegroundColor Green
