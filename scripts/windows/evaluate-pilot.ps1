. (Join-Path $PSScriptRoot "Common.ps1")

Assert-DockerAvailable

& docker run --rm `
    -v "${script:ProjectRoot}:/workspace:ro" `
    -w /workspace `
    node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a `
    node scripts/evaluate-pilot.mjs

exit $LASTEXITCODE
