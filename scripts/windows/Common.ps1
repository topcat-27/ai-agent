$ErrorActionPreference = "Stop"

$script:ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:EnvFile = Join-Path $script:ProjectRoot ".env"
$script:ComposeFile = Join-Path $script:ProjectRoot "compose.yaml"

function Invoke-Compose {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ComposeArguments
    )

    & docker compose `
        --project-directory $script:ProjectRoot `
        --env-file $script:EnvFile `
        -f $script:ComposeFile `
        @ComposeArguments

    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed with exit code $LASTEXITCODE."
    }
}

function Assert-DockerAvailable {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker Desktop is not installed or docker is not on PATH."
    }

    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop is not running. Open it, wait for it to finish starting, then try again."
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose is unavailable."
    }
}

function Get-EnvValue {
    param(
        [string]$Name,
        [string]$Fallback
    )

    if (-not (Test-Path $script:EnvFile)) {
        return $Fallback
    }

    $line = Get-Content $script:EnvFile |
        Where-Object { $_ -match "^$([Regex]::Escape($Name))=" } |
        Select-Object -Last 1

    if (-not $line) {
        return $Fallback
    }

    return ($line -split "=", 2)[1]
}

function Test-ServiceRunning {
    param([string]$Service)

    if (-not (Test-Path $script:EnvFile)) {
        return $false
    }

    try {
        $services = @(Invoke-Compose @("ps", "--status", "running", "--services"))
        return $services -contains $Service
    }
    catch {
        return $false
    }
}

function Wait-Endpoint {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for $Url."
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [ok] $Message" -ForegroundColor Green
}

function Write-Failure {
    param([string]$Message)
    Write-Host "  [!!] $Message" -ForegroundColor Red
}
