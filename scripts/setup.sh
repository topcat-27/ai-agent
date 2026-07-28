#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    --env-file "${ENV_FILE}" \
    -f "${PROJECT_ROOT}/compose.yaml" \
    "$@"
}

reviewed_workflows_are_installed() {
  local diagnostic_path="/tmp/ai-solopreneur-setup-checklist.json"
  local result=1

  if compose exec -T n8n \
    n8n export:workflow \
      --id=phase6LearnerChecklist \
      --output="${diagnostic_path}" >/dev/null 2>&1; then
    if compose exec -T n8n node -e \
      "const fs=require('fs'); const raw=JSON.parse(fs.readFileSync('${diagnostic_path}','utf8')); const workflows=Array.isArray(raw)?raw:[raw]; process.exit(workflows.some((workflow)=>workflow.id==='phase6LearnerChecklist')?0:1);" \
      >/dev/null 2>&1; then
      result=0
    fi
  fi

  compose exec -T n8n \
    sh -c "rm -f -- '${diagnostic_path}'" >/dev/null 2>&1 || true
  return "${result}"
}

env_value() {
  local key="$1"
  local fallback="$2"
  local value=""

  value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1)"
  printf '%s' "${value:-${fallback}}"
}

set_encryption_key() {
  local encryption_key="$1"
  local temporary_file=""

  temporary_file="$(mktemp "${PROJECT_ROOT}/.env.tmp.XXXXXX")"
  awk -v encryption_key="${encryption_key}" '
    BEGIN { replaced = 0 }
    /^N8N_ENCRYPTION_KEY=/ {
      print "N8N_ENCRYPTION_KEY=" encryption_key
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print "N8N_ENCRYPTION_KEY=" encryption_key
      }
    }
  ' "${ENV_FILE}" >"${temporary_file}"
  chmod 600 "${temporary_file}"
  mv "${temporary_file}" "${ENV_FILE}"
}

if [[ ! -f "${ENV_FILE}" ]]; then
  umask 077
  ENCRYPTION_KEY="$(generate_secret)"
  {
    printf 'COMPOSE_PROJECT_NAME=ai-solopreneur\n'
    printf 'CHAT_PORT=3000\n'
    printf 'N8N_PORT=5678\n'
    printf 'GENERIC_TIMEZONE=Australia/Melbourne\n'
    printf 'N8N_ENCRYPTION_KEY=%s\n' "${ENCRYPTION_KEY}"
  } >"${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  printf 'Created a private .env file with a generated n8n encryption key.\n'
else
  EXISTING_KEY="$(env_value N8N_ENCRYPTION_KEY '')"
  if [[ "${#EXISTING_KEY}" -lt 32 || "${EXISTING_KEY}" == replace-* ]]; then
    set_encryption_key "$(generate_secret)"
    printf 'Replaced the example encryption-key placeholder with a private generated key.\n'
  else
    printf 'Using the existing private .env file.\n'
  fi
fi

"${PROJECT_ROOT}/scripts/preflight.sh"

printf '\nDownloading the pinned local images...\n'
compose pull n8n

printf '\nBuilding the local chat app...\n'
compose build chat

printf '\nStarting AI Solopreneur...\n'
compose up -d --wait --wait-timeout 240

if reviewed_workflows_are_installed; then
  printf '\nThe reviewed workflows are already installed; keeping local edits unchanged.\n'
else
  printf '\nInstalling the reviewed workflows, sample data, and enabled skills...\n'
  if ! "${PROJECT_ROOT}/scripts/import-workflows.sh"; then
    printf '\nAutomatic workflow import did not finish.\n' >&2
    printf 'The local services are still available. Fix the message above, then double-click import-workflows.command.\n' >&2
    exit 1
  fi
fi

CHAT_PORT="$(env_value CHAT_PORT 3000)"
N8N_PORT="$(env_value N8N_PORT 5678)"

curl --fail --silent --show-error "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

printf '\nLocal stack is healthy.\n'
printf '  Chat app:          http://localhost:%s\n' "${CHAT_PORT}"
printf '  n8n editor:       http://localhost:%s\n' "${N8N_PORT}"
printf '  Next: create the local n8n owner, then open 01 - START HERE - Learner Checklist.\n'
