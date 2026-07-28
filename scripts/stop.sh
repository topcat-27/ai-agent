#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Nothing to stop because local setup has not been completed.\n'
  exit 0
fi

docker compose \
  --project-directory "${PROJECT_ROOT}" \
  --env-file "${ENV_FILE}" \
  -f "${PROJECT_ROOT}/compose.yaml" \
  stop

printf 'AI Solopreneur is stopped. Local data is preserved.\n'
