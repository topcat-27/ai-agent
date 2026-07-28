#!/usr/bin/env bash

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
COMPOSE_FILE="${PROJECT_ROOT}/compose.yaml"
MAIN_EXPORT="/tmp/ai-solopreneur-diagnostic-main.json"
CHECKLIST_EXPORT="/tmp/ai-solopreneur-diagnostic-checklist.json"
CREDENTIAL_EXPORT="/tmp/ai-solopreneur-diagnostic-credentials.json"
FAILURES=0
ACTIONS=0
N8N_RUNNING=0

ok() {
  printf '  [ok]   %s\n' "$1"
}

action() {
  printf '  [next] %s\n' "$1"
  ACTIONS=$((ACTIONS + 1))
}

failure() {
  printf '  [!!]   %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

env_value() {
  local key="$1"
  local fallback="$2"
  local value=""

  if [[ -f "${ENV_FILE}" ]]; then
    value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1)"
  fi
  printf '%s' "${value:-${fallback}}"
}

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

cleanup() {
  if [[ "${N8N_RUNNING}" == "1" ]]; then
    compose exec -T n8n sh -c \
      "rm -f -- '${MAIN_EXPORT}' '${CHECKLIST_EXPORT}' '${CREDENTIAL_EXPORT}'" \
      >/dev/null 2>&1 || true
  fi
}

workflow_export_contains_id() {
  local export_path="$1"
  local workflow_id="$2"

  compose exec -T n8n node -e \
    "const fs=require('fs'); const raw=JSON.parse(fs.readFileSync('${export_path}','utf8')); const rows=Array.isArray(raw)?raw:[raw]; process.exit(rows.some((row)=>row.id==='${workflow_id}')?0:1);" \
    >/dev/null 2>&1
}

workflow_export_is_active() {
  local export_path="$1"
  local workflow_id="$2"

  compose exec -T n8n node -e \
    "const fs=require('fs'); const raw=JSON.parse(fs.readFileSync('${export_path}','utf8')); const rows=Array.isArray(raw)?raw:[raw]; const row=rows.find((item)=>item.id==='${workflow_id}'); process.exit(row?.active===true?0:1);" \
    >/dev/null 2>&1
}

credential_is_selected() {
  compose exec -T n8n node -e \
    "const fs=require('fs'); const workflowRaw=JSON.parse(fs.readFileSync('${MAIN_EXPORT}','utf8')); const workflows=Array.isArray(workflowRaw)?workflowRaw:[workflowRaw]; const workflow=workflows.find((row)=>row.id==='phase3StartHere'); const reference=workflow?.nodes?.find((node)=>node.name==='Claude - Sonnet 4.6')?.credentials?.anthropicApi; const credentialRaw=JSON.parse(fs.readFileSync('${CREDENTIAL_EXPORT}','utf8')); const credentials=Array.isArray(credentialRaw)?credentialRaw:[credentialRaw]; const found=reference?.id&&credentials.some((credential)=>credential.id===reference.id&&credential.type==='anthropicApi'); process.exit(found?0:1);" \
    >/dev/null 2>&1
}

trap cleanup EXIT

printf 'AI Solopreneur diagnostics\n'
printf 'This check never calls Claude or displays credential values.\n\n'

if command -v docker >/dev/null 2>&1; then
  ok "Docker command is available."
else
  failure "Docker Desktop is not installed or Docker is not on PATH."
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "Docker Desktop is running."
else
  failure "Docker Desktop is not running. Open it, wait for Ready, then rerun diagnostics."
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker Compose is available."
else
  failure "Docker Compose is unavailable. Update Docker Desktop."
fi

if [[ -f "${ENV_FILE}" ]]; then
  ok "Private local configuration exists."
else
  failure "Local setup has not run. Double-click setup.command first."
fi

if [[ "${FAILURES}" -eq 0 ]] && compose config --quiet >/dev/null 2>&1; then
  ok "Docker Compose configuration is valid."
elif [[ -f "${ENV_FILE}" ]]; then
  failure "Docker Compose configuration is invalid. Compare .env with .env.example."
fi

CHAT_PORT="$(env_value CHAT_PORT 3000)"
N8N_PORT="$(env_value N8N_PORT 5678)"

if [[ "${FAILURES}" -eq 0 ]] && \
  compose ps --status running --services 2>/dev/null | grep -qx n8n; then
  N8N_RUNNING=1
  ok "n8n container is running."
else
  failure "n8n is not running. Double-click start.command, then rerun diagnostics."
fi

if [[ "${FAILURES}" -eq 0 ]] && \
  compose ps --status running --services 2>/dev/null | grep -qx chat; then
  ok "Chat container is running."
else
  failure "The chat service is not running. Double-click start.command, then rerun diagnostics."
fi

if command -v curl >/dev/null 2>&1 && \
  curl --fail --silent --show-error \
    "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null 2>&1; then
  ok "n8n health endpoint responds."
else
  failure "n8n is not healthy at localhost:${N8N_PORT}."
fi

if command -v curl >/dev/null 2>&1 && \
  curl --fail --silent --show-error \
    "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null 2>&1; then
  ok "Chat health endpoint responds."
else
  failure "The chat is not healthy at localhost:${CHAT_PORT}."
fi

if [[ "${N8N_RUNNING}" == "1" ]]; then
  if compose exec -T n8n n8n export:workflow \
      --id=phase6LearnerChecklist \
      --output="${CHECKLIST_EXPORT}" >/dev/null 2>&1 && \
    workflow_export_contains_id "${CHECKLIST_EXPORT}" "phase6LearnerChecklist"; then
    ok "The learner checklist is installed."
  else
    action "Install the reviewed workflows by double-clicking import-workflows.command."
  fi

  MAIN_INSTALLED=0
  if compose exec -T n8n n8n export:workflow \
      --id=phase3StartHere \
      --output="${MAIN_EXPORT}" >/dev/null 2>&1 && \
    workflow_export_contains_id "${MAIN_EXPORT}" "phase3StartHere"; then
    MAIN_INSTALLED=1
    ok "The Project Partner workflow is installed."
  else
    action "Install the Project Partner workflow with import-workflows.command."
  fi

  if [[ "${MAIN_INSTALLED}" == "1" ]]; then
    if workflow_export_is_active "${MAIN_EXPORT}" "phase3StartHere"; then
      ok "The Project Partner workflow is published."
    else
      action "Open 00 - START HERE - Project Partner in n8n, select the Claude credential, and publish it."
    fi

    if compose exec -T n8n n8n export:credentials \
        --all \
        --output="${CREDENTIAL_EXPORT}" >/dev/null 2>&1 && \
      credential_is_selected; then
      ok "An Anthropic credential exists and is selected by the Claude node."
    else
      action "Create an Anthropic credential named Anthropic account and select it in Claude - Sonnet 4.6."
    fi

    if command -v curl >/dev/null 2>&1; then
      AGENT_STATUS="$(
        curl --silent \
          --output /dev/null \
          --write-out '%{http_code}' \
          -X POST "http://127.0.0.1:${N8N_PORT}/webhook/chat" \
          -H 'Content-Type: application/json' \
          --data '{"sessionId":"diagnostic","message":"diagnostic"}' \
          2>/dev/null || true
      )"
    else
      AGENT_STATUS=""
    fi
    if [[ "${AGENT_STATUS}" == "400" ]]; then
      ok "The published chat webhook safely rejected the credential-free diagnostic request."
    else
      action "Publish 00 - START HERE - Project Partner so the chat webhook becomes available."
    fi
  fi

  if command -v curl >/dev/null 2>&1 && \
    curl --fail --silent --show-error \
      "http://127.0.0.1:${N8N_PORT}/webhook/agent-health" >/dev/null 2>&1; then
    ok "The optional agent-health workflow is published."
  else
    action "Publish 90 - DEBUG - Agent Health for the safe local health check."
  fi
fi

printf '\n'
if [[ "${FAILURES}" -gt 0 ]]; then
  printf 'Diagnostics found %s local service problem(s) and %s setup action(s).\n' \
    "${FAILURES}" "${ACTIONS}" >&2
  printf 'Start with the [!!] lines, then run this helper again.\n' >&2
  exit 1
fi

if [[ "${ACTIONS}" -gt 0 ]]; then
  printf 'The local services are healthy. Complete %s [next] action(s), then run diagnostics again.\n' \
    "${ACTIONS}"
  exit 1
fi

printf 'All checks are green. The local agent is ready for a real Claude message.\n'
