param(
    [string]$OutputRoot,
    [switch]$MetadataOnly
)

. (Join-Path $PSScriptRoot "Common.ps1")

$version = (Get-Content (Join-Path $script:ProjectRoot "VERSION") -Raw).Trim()
$n8nImage = "docker.n8n.io/n8nio/n8n:2.30.5@sha256:450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f"
$nodeImage = "node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a"
$chatImage = "ai-solopreneur-chat:$version"

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $script:ProjectRoot "instructor-pack"
}

if ($MetadataOnly) {
    $platform = "metadata-test"
    $commit = "uncommitted-validation"
}
else {
    Assert-DockerAvailable

    $status = & git -C $script:ProjectRoot status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw "Git is required to create the versioned source archive."
    }
    if ($status) {
        throw "The Git worktree has uncommitted changes. Commit or discard them before creating a release kit."
    }

    $platform = (& docker info --format "{{.OSType}}-{{.Architecture}}").Trim().ToLowerInvariant().Replace("/", "-")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not identify the Docker platform."
    }
    $commit = (& git -C $script:ProjectRoot rev-parse HEAD).Trim()
}

$packDirectory = Join-Path $OutputRoot "v$version-$platform"
if (Test-Path $packDirectory) {
    throw "Instructor pack already exists: $packDirectory. Move or remove that specific folder before trying again."
}

$workflowDirectory = Join-Path $packDirectory "workflows"
New-Item -ItemType Directory -Path $workflowDirectory -Force | Out-Null

if ($MetadataOnly) {
    & node (Join-Path $script:ProjectRoot "scripts\validate-release.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Release validation failed." }
    & node (Join-Path $script:ProjectRoot "scripts\validate-workflows.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Workflow validation failed." }
}
else {
    & docker run --rm `
        -v "${script:ProjectRoot}:/workspace:ro" `
        -w /workspace `
        $nodeImage `
        node scripts/validate-release.mjs
    if ($LASTEXITCODE -ne 0) { throw "Release validation failed." }

    & docker run --rm `
        -v "${script:ProjectRoot}:/workspace:ro" `
        -w /workspace `
        $nodeImage `
        node scripts/validate-workflows.mjs
    if ($LASTEXITCODE -ne 0) { throw "Workflow validation failed." }
}

Copy-Item (Join-Path $script:ProjectRoot "n8n\workflows\*.json") $workflowDirectory

@"
AI Solopreneur instructor kit
Version: $version
Commit: $commit
Platform: $platform
n8n image: $n8nImage
Node image: $nodeImage
Chat image: $chatImage
Generated UTC: $((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
"@ | Set-Content (Join-Path $packDirectory "RELEASE-METADATA.txt") -Encoding utf8

@"
# Load the workshop images

This kit is for **$platform** and AI Solopreneur **v$version**.

1. Install and open Docker Desktop.
2. Wait until its engine reports ready.
3. Open PowerShell in this folder.
4. Run ``docker load -i docker-images-$platform.tar``.
5. Confirm the n8n and ``$chatImage`` images appear in Docker Desktop.

The archive reduces workshop downloads. Real Claude messages still require
internet access and each learner's private Anthropic API key.
"@ | Set-Content (Join-Path $packDirectory "LOAD_IMAGES.md") -Encoding utf8

if (-not $MetadataOnly) {
    Write-Host "Pulling locked images..."
    & docker pull $n8nImage
    if ($LASTEXITCODE -ne 0) { throw "Could not pull the locked n8n image." }
    & docker pull $nodeImage
    if ($LASTEXITCODE -ne 0) { throw "Could not pull the locked Node image." }

    Write-Host "Building the versioned chat image..."
    & docker build --tag $chatImage (Join-Path $script:ProjectRoot "apps\chat")
    if ($LASTEXITCODE -ne 0) { throw "Could not build the chat image." }

    $imageArchive = Join-Path $packDirectory "docker-images-$platform.tar"
    & docker image save --output $imageArchive $n8nImage $nodeImage $chatImage
    if ($LASTEXITCODE -ne 0) { throw "Could not save the Docker images." }

    $sourceArchive = Join-Path $packDirectory "ai-solopreneur-v$version-source.zip"
    & git -C $script:ProjectRoot archive `
        --format=zip `
        "--prefix=ai-solopreneur-v$version/" `
        "--output=$sourceArchive" `
        HEAD
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Git source archive." }
}

$checksumFile = Join-Path $packDirectory "SHA256SUMS"
Get-ChildItem $packDirectory -Recurse -File |
    Where-Object { $_.FullName -ne $checksumFile } |
    Sort-Object FullName |
    ForEach-Object {
        $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $relative = [IO.Path]::GetRelativePath($packDirectory, $_.FullName).Replace("\", "/")
        "$hash  $relative"
    } |
    Set-Content $checksumFile -Encoding ascii

Write-Host "`nInstructor kit created at:`n  $packDirectory" -ForegroundColor Green
if ($MetadataOnly) {
    Write-Host "Metadata-only mode did not save Docker images or the Git source archive."
}
else {
    Write-Host "Keep the kit private until you have checked it and copied it securely."
}
