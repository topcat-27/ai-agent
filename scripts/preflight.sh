#!/usr/bin/env bash

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
COMPOSE_FILE="${PROJECT_ROOT}/compose.yaml"
FAILURES=0

success() {
  printf '  [ok] %s\n' "$1"
}

failure() {
  printf '  [!!] %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

note() {
  printf '       %s\n' "$1"
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

service_is_running() {
  local service="$1"
  [[ -f "${ENV_FILE}" ]] || return 1
  compose ps --status running --services 2>/dev/null | grep -qx "${service}"
}

check_port() {
  local port="$1"
  local service="$2"

  if service_is_running "${service}"; then
    success "Port ${port} is owned by the running ${service} service."
    return
  fi

  if ! command -v lsof >/dev/null 2>&1; then
    note "Port ${port} was not checked because lsof is unavailable."
    return
  fi

  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    failure "Port ${port} is already in use by another application."
    note "Close that application or change the matching value in .env."
  else
    success "Port ${port} is available."
  fi
}

valid_port() {
  local port="$1"
  [[ "${port}" =~ ^[0-9]+$ ]] && [[ "${port}" -ge 1 ]] && [[ "${port}" -le 65535 ]]
}

printf 'AI Solopreneur local preflight\n\n'

if command -v docker >/dev/null 2>&1; then
  success "Docker command found."
else
  failure "Docker Desktop is not installed or docker is not on PATH."
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  success "Docker engine is running."
else
  failure "Docker engine is not running."
  note "Open Docker Desktop, wait for it to finish starting, then try again."
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  success "Docker Compose is available."
else
  failure "Docker Compose is unavailable."
fi

if command -v curl >/dev/null 2>&1; then
  success "curl is available for local health checks."
else
  failure "curl is required for local health checks."
fi

if [[ -f "${ENV_FILE}" ]]; then
  success "Local .env file exists."
else
  failure "Local .env file is missing."
  note "Run ./setup.command or ./scripts/setup.sh first."
fi

if [[ -f "${ENV_FILE}" ]] && compose config --quiet >/dev/null 2>&1; then
  success "Docker Compose configuration is valid."
elif [[ -f "${ENV_FILE}" ]]; then
  failure "Docker Compose configuration is invalid."
  note "Check .env against .env.example."
fi

ENCRYPTION_KEY="$(env_value N8N_ENCRYPTION_KEY '')"
if [[ "${#ENCRYPTION_KEY}" -ge 32 && "${ENCRYPTION_KEY}" != replace-* ]]; then
  success "n8n encryption key is configured."
else
  failure "n8n encryption key is missing or still uses the example placeholder."
  note "Run the setup script to generate a private key."
fi

CHAT_PORT="$(env_value CHAT_PORT 3000)"
N8N_PORT="$(env_value N8N_PORT 5678)"

if valid_port "${CHAT_PORT}"; then
  check_port "${CHAT_PORT}" chat
else
  failure "CHAT_PORT must be a number between 1 and 65535."
fi

if valid_port "${N8N_PORT}"; then
  check_port "${N8N_PORT}" n8n
else
  failure "N8N_PORT must be a number between 1 and 65535."
fi

printf '\n'
if [[ "${FAILURES}" -gt 0 ]]; then
  printf 'Preflight failed with %s problem(s).\n' "${FAILURES}" >&2
  exit 1
fi

printf 'Preflight passed. This computer is ready for the local stack.\n'
