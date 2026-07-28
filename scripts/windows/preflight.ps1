. (Join-Path $PSScriptRoot "Common.ps1")

$failures = 0

Write-Host "AI Solopreneur local preflight`n"

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Ok "Docker command found."
}
else {
    Write-Failure "Docker Desktop is not installed or docker is not on PATH."
    $failures += 1
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker engine is running."
    }
    else {
        Write-Failure "Docker engine is not running."
        Write-Host "       Open Docker Desktop, wait for it to finish starting, then try again."
        $failures += 1
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker Compose is available."
    }
    else {
        Write-Failure "Docker Compose is unavailable."
        $failures += 1
    }
}

if (Test-Path $script:EnvFile) {
    Write-Ok "Local .env file exists."
    try {
        Invoke-Compose @("config", "--quiet") *> $null
        Write-Ok "Docker Compose configuration is valid."
    }
    catch {
        Write-Failure "Docker Compose configuration is invalid."
        Write-Host "       Check .env against .env.example."
        $failures += 1
    }
}
else {
    Write-Failure "Local .env file is missing."
    Write-Host "       Run setup-windows.cmd first."
    $failures += 1
}

$encryptionKey = Get-EnvValue "N8N_ENCRYPTION_KEY" ""
if ($encryptionKey.Length -ge 32 -and -not $encryptionKey.StartsWith("replace-")) {
    Write-Ok "n8n encryption key is configured."
}
else {
    Write-Failure "n8n encryption key is missing or still uses the example placeholder."
    Write-Host "       Run the setup script to generate a private key."
    $failures += 1
}

function Test-LocalPort {
    param(
        [int]$Port,
        [string]$Service
    )

    if (Test-ServiceRunning $Service) {
        Write-Ok "Port $Port is owned by the running $Service service."
        return
    }

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listeners) {
        Write-Failure "Port $Port is already in use by another application."
        Write-Host "       Close that application or change the matching value in .env."
        $script:failures += 1
    }
    else {
        Write-Ok "Port $Port is available."
    }
}

function Test-ConfiguredPort {
    param(
        [string]$Name,
        [string]$Fallback,
        [string]$Service
    )

    $value = Get-EnvValue $Name $Fallback
    $parsedPort = 0
    if (-not [int]::TryParse($value, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
        Write-Failure "$Name must be a number between 1 and 65535."
        $script:failures += 1
        return
    }

    Test-LocalPort $parsedPort $Service
}

Test-ConfiguredPort "CHAT_PORT" "3000" "chat"
Test-ConfiguredPort "N8N_PORT" "5678" "n8n"

Write-Host
if ($failures -gt 0) {
    throw "Preflight failed with $failures problem(s)."
}

Write-Host "Preflight passed. This computer is ready for the local stack." -ForegroundColor Green
