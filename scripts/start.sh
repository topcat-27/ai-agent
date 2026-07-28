#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Local setup has not been completed. Run ./setup.command first.\n' >&2
  exit 1
fi

env_value() {
  local key="$1"
  local fallback="$2"
  local value=""

  value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1)"
  printf '%s' "${value:-${fallback}}"
}

"${PROJECT_ROOT}/scripts/preflight.sh"

docker compose \
  --project-directory "${PROJECT_ROOT}" \
  --env-file "${ENV_FILE}" \
  -f "${PROJECT_ROOT}/compose.yaml" \
  up -d --wait --wait-timeout 240

CHAT_PORT="$(env_value CHAT_PORT 3000)"
N8N_PORT="$(env_value N8N_PORT 5678)"

curl --fail --silent --show-error "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

printf 'AI Solopreneur is healthy.\n'
printf '  Chat app:          http://localhost:%s\n' "${CHAT_PORT}"
printf '  n8n editor:       http://localhost:%s\n' "${N8N_PORT}"
