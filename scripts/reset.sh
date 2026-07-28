#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
CONFIRMED=false

if [[ "${1:-}" == "--yes" ]]; then
  CONFIRMED=true
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Nothing to reset because local setup has not been completed.\n'
  exit 0
fi

if [[ "${CONFIRMED}" != "true" ]]; then
  printf 'This permanently removes local n8n users, credentials, workflows, and history.\n'
  printf 'Create a backup first if any of that data matters.\n'
  read -r -p 'Type RESET to continue: ' ANSWER
  if [[ "${ANSWER}" != "RESET" ]]; then
    printf 'Reset cancelled.\n'
    exit 0
  fi
fi

docker compose \
  --project-directory "${PROJECT_ROOT}" \
  --env-file "${ENV_FILE}" \
  -f "${PROJECT_ROOT}/compose.yaml" \
  down --volumes --remove-orphans

printf 'Local n8n data has been removed. The private .env file was preserved.\n'
printf 'Run ./start.command to create a fresh local instance.\n'
