#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker Desktop is required to evaluate pilot evidence.\n' >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop is not running. Open it, wait until it is ready, and try again.\n' >&2
  exit 2
fi

docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node scripts/evaluate-pilot.mjs "$@"
