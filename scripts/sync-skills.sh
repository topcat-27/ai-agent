#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
SKILL_SYNC_WORKFLOW_ID="phase5SyncEnabledSkills"
SKILL_SYNC_PUBLISHED=0

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    --env-file "${ENV_FILE}" \
    -f "${PROJECT_ROOT}/compose.yaml" \
    "$@"
}

cleanup() {
  if [[ "${SKILL_SYNC_PUBLISHED}" == "1" ]]; then
    compose exec -T n8n \
      n8n unpublish:workflow --id="${SKILL_SYNC_WORKFLOW_ID}" >/dev/null 2>&1 || true
    compose restart n8n >/dev/null 2>&1 || true
    compose up -d --wait --wait-timeout 240 n8n >/dev/null 2>&1 || true
  fi
}

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Local setup has not been completed. Run ./setup.command first.\n' >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop is not running.\n' >&2
  exit 1
fi

if [[ -z "${N8N_PORT:-}" ]]; then
  N8N_PORT="$(sed -n 's/^N8N_PORT=//p' "${ENV_FILE}" | tail -n 1)"
fi
N8N_PORT="${N8N_PORT:-5678}"

if ! compose ps --status running --services | grep -qx n8n; then
  printf 'n8n is not running. Start the local stack first.\n' >&2
  exit 1
fi

printf 'Validating and compiling enabled skills...\n'
skill_bundle="$(
  docker run --rm \
    -v "${PROJECT_ROOT}:/workspace:ro" \
    -w /workspace \
    node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
    node scripts/compile-skills.mjs
)"

printf 'Opening the temporary localhost skill-sync endpoint...\n'
compose exec -T n8n \
  n8n publish:workflow --id="${SKILL_SYNC_WORKFLOW_ID}" >/dev/null
SKILL_SYNC_PUBLISHED=1
trap cleanup EXIT INT TERM
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null

response="$(
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/sync-enabled-skills" \
    -H 'Content-Type: application/json' \
    --data-binary "${skill_bundle}"
)"
if [[ "${response}" != *'"ok":true'* ]]; then
  printf 'Enabled skill sync returned an unexpected response: %s\n' \
    "${response}" >&2
  exit 1
fi

compose exec -T n8n \
  n8n unpublish:workflow --id="${SKILL_SYNC_WORKFLOW_ID}" >/dev/null
SKILL_SYNC_PUBLISHED=0
trap - EXIT INT TERM
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null

printf 'Enabled skills synced successfully.\n'
printf 'Open http://localhost:%s and start a new browser conversation.\n' "${N8N_PORT}"
