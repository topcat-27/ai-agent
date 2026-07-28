#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
BACKUP_ROOT="${PROJECT_ROOT}/backups"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
WAS_RUNNING=false
BACKUP_OWNER_UID="$(id -u)"
BACKUP_OWNER_GID="$(id -g)"

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    --env-file "${ENV_FILE}" \
    -f "${PROJECT_ROOT}/compose.yaml" \
    "$@"
}

restart_if_needed() {
  if [[ "${WAS_RUNNING}" == "true" ]]; then
    compose up -d --wait --wait-timeout 240 >/dev/null
  fi
}

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Cannot back up before local setup. Run ./setup.command first.\n' >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop is not running.\n' >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

if compose ps --status running --services | grep -qx n8n; then
  WAS_RUNNING=true
  compose stop n8n >/dev/null
fi

trap restart_if_needed EXIT

compose run --rm --no-deps \
  --user 0:0 \
  -e "BACKUP_OWNER_UID=${BACKUP_OWNER_UID}" \
  -e "BACKUP_OWNER_GID=${BACKUP_OWNER_GID}" \
  -v "${BACKUP_DIR}:/backup" \
  --entrypoint /bin/sh \
  n8n \
  -c 'tar -czf /backup/n8n-data.tar.gz -C /home/node/.n8n . &&
    chown "${BACKUP_OWNER_UID}:${BACKUP_OWNER_GID}" /backup/n8n-data.tar.gz &&
    chmod 600 /backup/n8n-data.tar.gz'

cp "${ENV_FILE}" "${BACKUP_DIR}/env.backup"
chmod 600 "${BACKUP_DIR}/env.backup"

restart_if_needed
WAS_RUNNING=false
trap - EXIT

printf 'Backup created at:\n  %s\n' "${BACKUP_DIR}"
printf 'It contains encrypted credentials and the encryption key. Keep it private.\n'
